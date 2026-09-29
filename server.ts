import express from 'express';
import path from 'path';
import fs from 'fs';
import { createServer as createViteServer } from 'vite';

// ---------------------------------------------------------------------------
// Download counter — a single honest number: PDFs actually compiled to
// completion by real users. Persisted to disk so it survives restarts and
// deploys. Starts at zero; only /api/stats/download with a non-empty
// documentId increments it, so the count reflects genuine finished downloads.
// ---------------------------------------------------------------------------
const STATS_PATH = process.env.STATS_PATH || path.join(process.cwd(), '.data', 'download-stats.json');

function loadDownloadCount(): number {
  try {
    if (fs.existsSync(STATS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(STATS_PATH, 'utf8'));
      const n = Number(parsed.totalDownloads);
      if (Number.isFinite(n) && n >= 0) return Math.floor(n);
    }
  } catch (_) {
    // Corrupt or unreadable file — fall through and start from zero.
  }
  return 0;
}

let totalDownloads = loadDownloadCount();

function saveDownloadCount(): void {
  try {
    fs.mkdirSync(path.dirname(STATS_PATH), { recursive: true });
    fs.writeFileSync(STATS_PATH, JSON.stringify({ totalDownloads, updatedAt: new Date().toISOString() }));
  } catch (err: any) {
    console.warn('[stats] Could not persist download count:', err.message);
  }
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // CORS headers for development/proxying
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    next();
  });

  // In-memory cache for metadata
  const metadataCache = new Map<string, { data: any; timestamp: number }>();

  // API 1: Extract Metadata from Scribd link
  app.get('/api/scribd-metadata', async (req, res) => {
    const { id } = req.query;
    if (!id || typeof id !== 'string') {
      res.status(400).json({ error: 'Scribd Document ID is required' });
      return;
    }

    // Return from cache if fresh (under 1 hour) and successful
    if (metadataCache.has(id)) {
      const cached = metadataCache.get(id)!;
      if (cached.data?.directImagesAccessible && Date.now() - cached.timestamp < 3600000) {
        console.log(`[API] Returning cached metadata for Scribd ID: ${id}`);
        res.json(cached.data);
        return;
      }
    }

    try {
      console.log(`[API] Fetching metadata for Scribd ID: ${id}`);
      let title = 'Scribd Document';
      let pageCount = 1;
      let secretKey = '';
      let thumbnailUrl = '';
      let html = '';
      const embedCookieJar: string[] = [];

      // Strategy 1: Fetch the embed page as WhatsApp (bypasses the JS challenge).
      // This is the primary strategy: it exposes per-page image paths
      // (images/{n}-{token}.jpg) under a session id, plus title & page count.
      let embedSession = '';
      const embedImagePaths = new Map<number, string>();
      try {
        const embedRes = await fetch(`https://www.scribd.com/embeds/${id}/content?start_page=1`, {
          headers: {
            'User-Agent': 'WhatsApp/2.23.20.0',
            'Accept': '*/*'
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(8000)
        });
        if (embedRes.ok) {
          const embedHtml = await embedRes.text();

          // Session id, e.g. html.scribdassets.com/56d3fdjeioe77ksq/
          const sessionMatch = embedHtml.match(/html\.scribdassets\.com\/([a-z0-9]+)\//i);
          if (sessionMatch) embedSession = sessionMatch[1];

          // Per-page image paths: images/{n}-{token}.jpg (pages may appear multiple times; keep first)
          const imgRe = /images\/(\d+)-([a-f0-9]+)\.jpg/gi;
          let m: RegExpExecArray | null;
          while ((m = imgRe.exec(embedHtml)) !== null) {
            const pageNum = parseInt(m[1], 10);
            if (!embedImagePaths.has(pageNum)) {
              embedImagePaths.set(pageNum, m[0]);
            }
          }

          // Title & page count from the embed as fallbacks
          const embedTitle = embedHtml.match(/"title"\s*:\s*"([^"]{3,150}?)"/);
          if (embedTitle && (title === 'Scribd Document' || !title)) {
            title = embedTitle[1].replace(/\\u0026/g, '&').replace(/\\'/g, "'").trim();
          }
          const embedPc = embedHtml.match(/"page_count"\s*:\s*(\d+)/);
          if (embedPc) pageCount = parseInt(embedPc[1], 10);

          // Secret key if present
          const embedSecret = embedHtml.match(/original\/([a-z0-9]+)\/\d+/) || embedHtml.match(/original\/([a-z0-9]{8,12})/i);
          if (embedSecret) secretKey = embedSecret[1];

          // Grab cookies for the image fetches (html.scribd.com requires them)
          const setCookies = embedRes.headers.getSetCookie?.() || [];
          for (const c of setCookies) {
            const pair = c.split(';')[0];
            if (pair && pair.includes('=')) embedCookieJar.push(pair);
          }

          // The embed only inlines image paths for the first few pages. The rest
          // are behind per-page .jsonp tokens — resolve them in parallel now.
          const jsonpTokens = new Map<number, string>();
          const jpRe = /pages\/(\d+)-([a-f0-9]+)\.jsonp/gi;
          while ((m = jpRe.exec(embedHtml)) !== null) {
            const pageNum = parseInt(m[1], 10);
            if (!jsonpTokens.has(pageNum)) jsonpTokens.set(pageNum, m[0]);
          }

          if (embedSession && jsonpTokens.size > 0) {
            const cookieHeader = embedCookieJar.join('; ');
            const jobs = [...jsonpTokens.entries()];
            let cursor = 0;

            const resolveWorker = async () => {
              while (cursor < jobs.length) {
                const [pageNum, token] = jobs[cursor++];
                if (embedImagePaths.has(pageNum)) continue;
                try {
                  const r = await fetch(`https://html.scribdassets.com/${embedSession}/${token}`, {
                    headers: {
                      'User-Agent': 'WhatsApp/2.23.20.0',
                      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
                      'Referer': `https://www.scribd.com/embeds/${id}/content?start_page=1`
                    },
                    signal: AbortSignal.timeout(8000)
                  });
                  if (r.ok) {
                    const text = await r.text();
                    const im = text.match(/images\/(\d+)-([a-f0-9]+)\.jpg/i);
                    if (im) embedImagePaths.set(pageNum, im[0]);
                  }
                } catch (_) {
                  // Leave this page unresolved; it will be skipped
                }
              }
            };

            await Promise.all(Array.from({ length: Math.min(8, jobs.length) }, () => resolveWorker()));
          }
        }
      } catch (e: any) {
        console.warn(`[API] Embed fetch note: ${e.message}`);
      }

      // Strategy 2: Fetch direct document page using Open Graph social crawler headers (bypasses bot challenges)
      try {
        const docRes = await fetch(`https://www.scribd.com/document/${id}`, {
          headers: {
            'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
            'Accept': '*/*'
          },
          redirect: 'follow',
          signal: AbortSignal.timeout(6000)
        });
        if (docRes.ok) {
          html = await docRes.text();

          // Extract clean title
          const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/i) ||
                             html.match(/<title>([^<]+)<\/title>/i);
          if (titleMatch) {
            title = titleMatch[1].replace(/\s*\|\s*PDF$/i, '').replace(/\s*\|\s*Scribd$/i, '').trim();
          }

          // Extract original image secret key
          const imgMatch = html.match(/<link rel="image_src" href="([^"]+)"/i);
          if (imgMatch) {
            const sMatch = imgMatch[1].match(/\/original\/([a-z0-9]+)\//i);
            if (sMatch) secretKey = sMatch[1];
          }

          // Extract targeted page count belonging specifically to this document ID
          const docObjMatch = html.match(new RegExp(`"id":\\s*${id}[\\s\\S]{1,800}?"page_count":\\s*(\\d+)`)) ||
                              html.match(new RegExp(`"page_count":\\s*(\\d+)[\\s\\S]{1,800}?"id":\\s*${id}`));
          if (docObjMatch) {
            pageCount = parseInt(docObjMatch[1], 10);
          } else {
            const pcMatch = html.match(/"page_count":\s*(\d+)/);
            if (pcMatch) pageCount = parseInt(pcMatch[1], 10);
          }
        }
      } catch (e: any) {
        console.warn(`[API] Direct document fetch note: ${e.message}`);
      }

      // Strategy 2: If secretKey or title is still missing, query Scribd oEmbed API
      if (!secretKey || !title || title === 'Scribd Document' || pageCount <= 1) {
        try {
          const oembedRes = await fetch(`https://www.scribd.com/services/oembed/?url=https://www.scribd.com/document/${id}/&format=json`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            signal: AbortSignal.timeout(4000)
          });
          if (oembedRes.ok) {
            const oembedData: any = await oembedRes.json();
            if (oembedData.title && (title === 'Scribd Document' || !title)) {
              title = oembedData.title;
            }
            if (oembedData.thumbnail_url) {
              thumbnailUrl = oembedData.thumbnail_url;
              if (!secretKey) {
                const thumbSecretMatch = oembedData.thumbnail_url.match(/document\/\d+\/[^/]+\/([a-z0-9]+)\//);
                if (thumbSecretMatch) secretKey = thumbSecretMatch[1];
              }
            }
          }
        } catch (_) {}
      }

      // Strategy 3: Try Embed page if still missing secretKey
      if (!secretKey) {
        try {
          const embedRes = await fetch(`https://www.scribd.com/embeds/${id}/content?start_page=1`, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
              'Referer': `https://www.scribd.com/document/${id}`
            },
            signal: AbortSignal.timeout(4000)
          });
          if (embedRes.ok) {
            const embedHtml = await embedRes.text();
            const embedSecret = embedHtml.match(/original\/([a-z0-9]+)\/\d+/) ||
                                embedHtml.match(/original\/([a-z0-9]{8,12})/i);
            if (embedSecret) secretKey = embedSecret[1];

            const embedPc = embedHtml.match(/"page_count"\s*:\s*(\d+)/);
            if (embedPc && pageCount <= 1) pageCount = parseInt(embedPc[1], 10);
          }
        } catch (_) {}
      }

      // Set thumbnail URL fallback from secretKey if not already set
      if (!thumbnailUrl && secretKey) {
        thumbnailUrl = `https://imgv2-1-f.scribdassets.com/img/document/${id}/111x142/${secretKey}/1?v=1`;
      }

      // Build per-page image URLs from the embed session (new working pattern).
      // Each page has a unique token: html.scribd.com/{session}/images/{n}-{token}.jpg
      // The image fetches need the embed cookies, which the client echoes back
      // to the proxy via the cookie= query parameter.
      const pageImages: string[] = [];
      const directImagesAccessible = embedSession && embedImagePaths.size > 0;
      if (directImagesAccessible && pageCount > 0) {
        const effectivePages = Math.min(Math.max(pageCount, embedImagePaths.size), 120);
        for (let p = 1; p <= effectivePages; p++) {
          const path = embedImagePaths.get(p);
          if (path) {
            pageImages.push(`https://html.scribd.com/${embedSession}/${path}`);
          }
        }
      }

      console.log(`[API] Metadata resolved: Title="${title}", Pages=${pageCount}, Session=${embedSession || 'none'}, ImageUrls=${pageImages.length}`);

      const responseData = {
        id,
        title,
        pageCount,
        secretKey,
        pageImages,
        directImagesAccessible: Boolean(directImagesAccessible),
        thumbnailUrl,
        // Session cookies from the embed page — the client must echo these back
        // to /api/proxy-image (cookie= param) for per-page images to be served.
        embedCookie: embedCookieJar.join('; ')
      };
      metadataCache.set(id, { data: responseData, timestamp: Date.now() });

      res.json(responseData);
    } catch (err: any) {
      console.error('[API] Error in /api/scribd-metadata:', err.message);
      res.status(500).json({ error: 'Failed to retrieve Scribd metadata: ' + err.message });
    }
  });

  // Public download counter
  app.get('/api/stats', (req, res) => {
    res.json({ totalDownloads });
  });

  // Incremented by the client only after a PDF has fully compiled
  app.post('/api/stats/download', (req, res) => {
    const docId = typeof req.body?.documentId === 'string' ? req.body.documentId.slice(0, 64) : '';
    if (!docId) {
      res.status(400).json({ error: 'documentId is required' });
      return;
    }
    totalDownloads += 1;
    saveDownloadCount();
    console.log(`[stats] PDF completed (doc ${docId}) — total: ${totalDownloads}`);
    res.json({ totalDownloads });
  });

  // In-memory buffer cache for proxied images
  const imageCache = new Map<string, { buffer: Buffer; contentType: string }>();

  // API 2: Image proxy to bypass CORS for client-side PDF rendering
  app.get('/api/proxy-image', async (req, res) => {
    const imageUrl = req.query.url as string;
    if (!imageUrl) {
      res.status(400).send('Image URL is required');
      return;
    }

    if (imageCache.has(imageUrl)) {
      const cached = imageCache.get(imageUrl)!;
      res.setHeader('Content-Type', cached.contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(cached.buffer);
      return;
    }

    try {
      // Forward the embed cookies when the client sends them — html.scribd.com
      // requires the session set by the embed page for per-page images.
      const embedCookie = req.query.cookie as string;
      const headers: Record<string, string> = {
        'User-Agent': 'WhatsApp/2.23.20.0',
        'Referer': 'https://www.scribd.com/'
      };
      if (embedCookie) {
        headers['Cookie'] = embedCookie;
      }

      const response = await fetch(imageUrl, {
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(15000)
      });

      if (!response.ok) {
        // Return HTTP status cleanly without throwing uncaught server errors
        res.status(response.status).send(`Upstream status ${response.status}`);
        return;
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('Content-Type') || 'image/jpeg';

      // Keep cache size bounded (max 500 images)
      if (imageCache.size > 500) {
        const firstKey = imageCache.keys().next().value;
        if (firstKey) imageCache.delete(firstKey);
      }
      imageCache.set(imageUrl, { buffer, contentType });

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(buffer);
    } catch (_) {
      res.status(502).send('Image proxy connection error');
    }
  });

  // Serve static UI assets
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Running at http://localhost:${PORT}`);
  });
}

startServer();
