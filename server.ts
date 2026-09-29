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

      // Strategy 1: Fetch direct document page using Open Graph social crawler headers (bypasses bot challenges)
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

      // Probe original page 1 image accessibility
      let directImagesAccessible = false;
      if (secretKey) {
        try {
          const probeRes = await fetch(`https://imgv2-1-f.scribdassets.com/img/document/${id}/original/${secretKey}/1?v=1`, {
            method: 'HEAD',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Referer': 'https://www.scribd.com/'
            },
            signal: AbortSignal.timeout(3000)
          });
          directImagesAccessible = probeRes.ok;
        } catch (_) {
          directImagesAccessible = false;
        }
      }

      // Populate full direct page image URLs if accessible
      const pageImages: string[] = [];
      if (directImagesAccessible && secretKey && pageCount > 0) {
        // Support up to full document pages (safe bound of 120 pages per batch)
        const effectivePages = Math.min(pageCount, 120);
        for (let p = 1; p <= effectivePages; p++) {
          pageImages.push(`https://imgv2-1-f.scribdassets.com/img/document/${id}/original/${secretKey}/${p}?v=1`);
        }
      }

      console.log(`[API] Metadata resolved: Title="${title}", Pages=${pageCount}, DirectImages=${directImagesAccessible}, PageImages=${pageImages.length}`);

      const responseData = {
        id,
        title,
        pageCount,
        secretKey,
        pageImages,
        directImagesAccessible,
        thumbnailUrl
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
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          'Referer': 'https://www.scribd.com/'
        },
        signal: AbortSignal.timeout(8000)
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
