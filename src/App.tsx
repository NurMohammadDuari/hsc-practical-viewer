import React, { useState, useEffect } from 'react';
import {
  FileText,
  Download,
  BookOpen,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Loader2,
  Play,
  Eye,
  ExternalLink,
  Smartphone,
  X,
  Share,
  FileDown,
  Sun,
  Moon,
  FileCheck2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';

type Theme = 'light' | 'dark';

export default function App() {
  // Theme state (system-aware, persisted, applied before first paint)
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = localStorage.getItem('hsc-theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    localStorage.setItem('hsc-theme', theme);

    // Keep the mobile browser chrome in sync with the theme
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#000000' : '#f5f5f7');
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  // Live download counter: fetched immediately, then every 20s
  const [totalDownloads, setTotalDownloads] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const fetchStats = async () => {
      try {
        const res = await fetch('/api/stats');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Number.isFinite(data?.totalDownloads)) {
          setTotalDownloads(data.totalDownloads);
        }
      } catch (_) {
        // Counter is decorative — ignore fetch failures
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 20000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Report a finished PDF to the server (fire-and-forget)
  const reportDownload = (docId: string) => {
    try {
      const body = JSON.stringify({ documentId: docId });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/stats/download', new Blob([body], { type: 'application/json' }));
      } else {
        fetch('/api/stats/download', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } }).catch(() => {});
      }
      setTotalDownloads((n) => (n === null ? 1 : n + 1));
    } catch (_) {}
  };

  // PWA install prompt states
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState<boolean>(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [showInstallGuideModal, setShowInstallGuideModal] = useState<boolean>(false);
  const [detectedPlatform, setDetectedPlatform] = useState<{ os: string; browser: string; isIOS: boolean; isAndroid: boolean }>({
    os: 'Unknown',
    browser: 'Browser',
    isIOS: false,
    isAndroid: false,
  });

  // Input state
  const [scribdUrl, setScribdUrl] = useState<string>(
    'https://www.scribd.com/document/835319016/Chemistry-2nd-Practical-By-Sadat-Rahman-Sarthok-GSC-HSC-25#from_embed'
  );

  useEffect(() => {
    // Detect OS & browser
    const ua = navigator.userAgent || '';
    const isIOS = /iPhone|iPad|iPod/i.test(ua);
    const isAndroid = /Android/i.test(ua);
    let os = 'Desktop';
    if (isIOS) os = 'iOS';
    else if (isAndroid) os = 'Android';

    let browser = 'Chrome';
    if (/CriOS|Chrome/i.test(ua) && !/Edg/i.test(ua)) browser = 'Chrome';
    else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari';
    else if (/Edg/i.test(ua)) browser = 'Edge';
    else if (/Firefox/i.test(ua)) browser = 'Firefox';
    else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';

    setDetectedPlatform({ os, browser, isIOS, isAndroid });

    if (window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone) {
      setIsInstalled(true);
    }

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallBanner(true);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setShowInstallBanner(false);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleTriggerInstall = async () => {
    if (deferredPrompt) {
      try {
        deferredPrompt.prompt();
        const choiceResult = await deferredPrompt.userChoice;
        if (choiceResult && choiceResult.outcome === 'accepted') {
          setIsInstalled(true);
          setShowInstallBanner(false);
        }
      } catch (err) {
        console.error('PWA prompt error:', err);
      }
      setDeferredPrompt(null);
    } else {
      setShowInstallGuideModal(true);
    }
  };

  // Document state
  const [documentId, setDocumentId] = useState<string>('835319016');
  const [previewMode, setPreviewMode] = useState<'pdf' | 'live'>('pdf');

  // Handle Android/iOS share-sheet launches: /share?url=...&text=...&title=...
  // Pre-fills the input, cleans the address bar, and auto-starts.
  useEffect(() => {
    if (!window.location.pathname.startsWith('/share')) return;
    const params = new URLSearchParams(window.location.search);
    const shared = params.get('url') || params.get('text') || params.get('title') || '';
    const match = shared.match(/https?:\/\/[^\s]+/i);
    const sharedUrl = match ? match[0] : '';
    if (sharedUrl && /scribd\.com/i.test(sharedUrl)) {
      setScribdUrl(sharedUrl);
      window.history.replaceState({}, '', '/');
      setTimeout(() => {
        const btn = document.getElementById('compile-pdf-btn') as HTMLButtonElement | null;
        btn?.click();
      }, 100);
    } else {
      window.history.replaceState({}, '', '/');
    }
  }, []);

  // Compilation state
  const [isCompiling, setIsCompiling] = useState(false);
  const [compilationProgress, setCompilationProgress] = useState(0);
  const [compilationStep, setCompilationStep] = useState('');
  const [compiledPdfUrl, setCompiledPdfUrl] = useState<string | null>(null);
  const [compiledPdfName, setCompiledPdfName] = useState<string>('HSC-Practical.pdf');
  const [compilationError, setCompilationError] = useState<string | null>(null);
  const [documentTitle, setDocumentTitle] = useState<string>('Chemistry 2nd Practical — Sadat Rahman Sarthok');

  // Live thumbnails: one entry per page, filled as each page finishes downloading.
  // null = still pending (rendered as a pulsing numbered slot).
  const [pageThumbnails, setPageThumbnails] = useState<(string | null)[]>([]);

  // Extract a clean document title from the URL slug if available
  const extractTitleFromUrl = (url: string): string => {
    try {
      const match = url.match(/(?:document|doc)\/\d+\/([a-zA-Z0-9_\-%]+)/);
      if (match && match[1]) {
        return decodeURIComponent(match[1]).replace(/[-_]+/g, ' ').trim();
      }
    } catch (_) {}
    return '';
  };

  // Parse the Scribd document ID from a URL
  const extractScribdId = (url: string): string | null => {
    const docIdRegex = /(?:document|embeds|doc)\/(\d+)/;
    const match = url.match(docIdRegex);
    if (match && match[1]) return match[1];

    const digitsMatch = url.match(/\d{9,12}/);
    if (digitsMatch) return digitsMatch[0];
    return null;
  };

  // Quick preview switch without recompiling
  const handleInstantLivePreview = () => {
    if (!scribdUrl.trim()) return;
    const extractedId = extractScribdId(scribdUrl);
    if (extractedId) {
      setDocumentId(extractedId);
      setPreviewMode('live');
      if (!compiledPdfUrl && !isCompiling) {
        handleCompilePdf();
      }
    }
  };

  // Download every page in parallel and compile into a single PDF
  const handleCompilePdf = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!scribdUrl.trim()) return;

    const extractedId = extractScribdId(scribdUrl);
    if (!extractedId) {
      setCompilationError('That does not look like a valid Scribd link. Please paste the full document URL.');
      return;
    }

    const slugTitle = extractTitleFromUrl(scribdUrl);
    if (slugTitle) {
      setDocumentTitle(slugTitle);
      setCompiledPdfName(`${slugTitle.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
    }

    setDocumentId(extractedId);
    setIsCompiling(true);
    setCompilationProgress(0);
    setCompilationError(null);
    setCompiledPdfUrl(null);

    try {
      // Step 1: Resolve document metadata
      setCompilationStep('Resolving document details…');
      setCompilationProgress(5);

      const metaRes = await fetch(`/api/scribd-metadata?id=${extractedId}`);
      if (!metaRes.ok) {
        throw new Error('Scribd is not responding right now. Please try again in a moment.');
      }

      const metadata = await metaRes.json();
      if (metadata.error) {
        throw new Error(metadata.error);
      }

      if (metadata.title) {
        setDocumentTitle(metadata.title);
        setCompiledPdfName(`${metadata.title.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`);
      }

      const { pageCount, secretKey, pageImages, directImagesAccessible } = metadata;
      const hasDirectImages = (pageImages && pageImages.length > 0) || (directImagesAccessible && secretKey && pageCount > 0);

      if (!hasDirectImages) {
        throw new Error('This document is restricted by Scribd and its pages cannot be exported. Try opening it in the live reader instead.');
      }

      // Step 2: Fetch all pages in parallel
      const totalPagesToFetch = (pageImages && pageImages.length > 0) ? pageImages.length : pageCount;

      setCompilationStep(`Downloading ${totalPagesToFetch} pages…`);
      setCompilationProgress(15);
      setPageThumbnails(new Array(totalPagesToFetch).fill(null));

      // Pre-allocate slots to preserve page order
      const pageSlots: (HTMLImageElement | null)[] = new Array(totalPagesToFetch).fill(null);
      let completedPagesCount = 0;

      const fetchSinglePage = async (p: number) => {
        let proxiedUrl = '';
        if (pageImages && pageImages.length > 0) {
          const rawUrl = pageImages[p - 1];
          proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(rawUrl)}`;
        } else {
          const rawCdnUrl = `https://imgv2-1-f.scribdassets.com/img/document/${extractedId}/original/${secretKey}/${p}?v=1`;
          proxiedUrl = `/api/proxy-image?url=${encodeURIComponent(rawCdnUrl)}`;
        }

        let loaded: HTMLImageElement | null = null;
        try {
          loaded = await loadImage(proxiedUrl);
          pageSlots[p - 1] = loaded;
        } catch (_) {
          if (!pageImages || pageImages.length === 0) {
            const alternateUrl = `https://imgv2-2-f.scribdassets.com/img/document/${extractedId}/original/${secretKey}/${p}?v=1`;
            try {
              loaded = await loadImage(`/api/proxy-image?url=${encodeURIComponent(alternateUrl)}`);
              pageSlots[p - 1] = loaded;
            } catch (_) {
              // Skip unavailable page
            }
          }
        }

        completedPagesCount++;
        const pct = 15 + Math.round((completedPagesCount / totalPagesToFetch) * 70);
        setCompilationProgress(pct);
        setCompilationStep(`Downloading ${completedPagesCount} of ${totalPagesToFetch} pages…`);

        // Capture a small preview of the page the moment it arrives
        if (loaded) {
          const thumb = makeThumbnail(loaded);
          if (thumb) {
            setPageThumbnails((prev) => {
              const next = [...prev];
              next[p - 1] = thumb;
              return next;
            });
          }
        }
      };

      // Worker queue with 24 concurrent streams
      const CONCURRENCY_LIMIT = 24;
      const queue = Array.from({ length: totalPagesToFetch }, (_, i) => i + 1);

      const workers = Array.from({ length: Math.min(CONCURRENCY_LIMIT, totalPagesToFetch) }, async () => {
        while (queue.length > 0) {
          const pageNum = queue.shift();
          if (pageNum) {
            await fetchSinglePage(pageNum);
          }
        }
      });

      await Promise.all(workers);

      const loadedImages = pageSlots.filter((img): img is HTMLImageElement => img !== null);

      if (loadedImages.length === 0) {
        throw new Error('The pages of this document could not be retrieved. It may be fully restricted on Scribd.');
      }

      // Step 3: Assemble the PDF
      setCompilationStep('Assembling your PDF…');
      setCompilationProgress(90);

      const pdf = new jsPDF({
        orientation: loadedImages[0].width > loadedImages[0].height ? 'landscape' : 'portrait',
        unit: 'px',
        format: [loadedImages[0].width, loadedImages[0].height],
        compress: true,
      });

      for (let i = 0; i < loadedImages.length; i++) {
        const img = loadedImages[i];
        if (i > 0) {
          pdf.addPage([img.width, img.height], img.width > img.height ? 'landscape' : 'portrait');
        }
        pdf.addImage(img, 'JPEG', 0, 0, img.width, img.height, undefined, 'FAST');
        if (i % 5 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const blob = pdf.output('blob');
      const blobUrl = URL.createObjectURL(blob);
      setCompiledPdfUrl(blobUrl);
      setPreviewMode('pdf');
      setCompilationProgress(100);
      setPageThumbnails([]);
      setIsCompiling(false);
      reportDownload(extractedId);
    } catch (err: any) {
      setCompilationError(err.message || 'Something went wrong while processing the document. Please try again.');
      setPageThumbnails([]);
      setIsCompiling(false);
    }
  };
  const loadImage = async (url: string): Promise<HTMLImageElement> => {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Proxy fetch failed');
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image asset'));
      img.src = objectUrl;
    });
  };

  // Draw a lightweight JPEG thumbnail of a page onto a canvas
  const makeThumbnail = (img: HTMLImageElement): string | null => {
    try {
      const maxWidth = 160;
      const scale = Math.min(1, maxWidth / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/jpeg', 0.6);
    } catch (_) {
      return null;
    }
  };

  const handleClear = () => {
    setScribdUrl('');
    setCompiledPdfUrl(null);
    setCompilationError(null);
    setPageThumbnails([]);
  };

  const loadChemistrySample = () => {
    setScribdUrl('https://www.scribd.com/document/835319016/Chemistry-2nd-Practical-By-Sadat-Rahman-Sarthok-GSC-HSC-25#from_embed');
    setDocumentId('835319016');
    setCompiledPdfUrl(null);
    setCompilationError(null);
    setPageThumbnails([]);
  };

  const loadReferenceSample = () => {
    setScribdUrl('https://www.scribd.com/document/423214959/Table-of-FIDIC-Cases-PDF');
    setDocumentId('423214959');
    setCompiledPdfUrl(null);
    setCompilationError(null);
    setPageThumbnails([]);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[var(--app)] text-[var(--t-primary)] overflow-hidden">
      {/* Header */}
      <header className="bg-[var(--surface)] backdrop-blur-xl border-b border-[var(--line)] px-4 sm:px-6 py-3 flex-shrink-0 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <img src="/icons/icon-192.png" alt="App icon" className="w-9 h-9 rounded-[10px] object-cover shadow-sm" />
          <div className="text-left">
            <h1 className="font-semibold text-[15px] sm:text-base tracking-tight text-[var(--t-primary)]">
              HSC Practical Viewer
            </h1>
            <p className="text-[11px] text-[var(--t-secondary)] leading-tight">
              View any Scribd document, or save it as a PDF
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Live download counter */}
          {totalDownloads !== null && (
            <div
              className="hidden sm:flex items-center gap-1.5 bg-[var(--fill)] text-[var(--t-secondary)] text-[11px] font-medium pl-2.5 pr-3 py-1.5 rounded-full"
              title="PDFs compiled by this app, counted in real time"
            >
              <FileCheck2 className="w-3.5 h-3.5 text-[var(--success)]" />
              <span className="text-[var(--t-primary)] font-semibold tabular-nums">
                {totalDownloads.toLocaleString()}
              </span>
              <span>PDF{totalDownloads === 1 ? '' : 's'} made</span>
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--success)] opacity-60"></span>
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[var(--success)]"></span>
              </span>
            </div>
          )}

          {/* Theme toggle */}
          <button
            id="theme-toggle-btn"
            type="button"
            onClick={toggleTheme}
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--fill)] hover:bg-[var(--fill-hover)] active:scale-90 text-[var(--t-secondary)] hover:text-[var(--t-primary)] transition-all cursor-pointer"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span
                key={theme}
                initial={{ rotate: -90, opacity: 0, scale: 0.6 }}
                animate={{ rotate: 0, opacity: 1, scale: 1 }}
                exit={{ rotate: 90, opacity: 0, scale: 0.6 }}
                transition={{ duration: 0.18 }}
                className="flex items-center justify-center"
              >
                {theme === 'dark' ? (
                  <Sun className="w-4 h-4" />
                ) : (
                  <Moon className="w-4 h-4" />
                )}
              </motion.span>
            </AnimatePresence>
          </button>

          {!isInstalled && (
            <button
              id="pwa-install-header-btn"
              type="button"
              onClick={handleTriggerInstall}
              className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:scale-[0.97] text-white font-medium text-xs px-4 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer"
              title="Install as an app on this device"
            >
              <Smartphone className="w-3.5 h-3.5" />
              <span>Install App</span>
            </button>
          )}
        </div>
      </header>

      {/* Main workspace */}
      <main className="flex-1 overflow-hidden relative min-h-0">
        <div className="h-full flex flex-col min-h-0">
          {/* Input panel */}
          <div className="bg-[var(--surface)] backdrop-blur-xl border-b border-[var(--line)] p-4 sm:p-5">
            <div className="max-w-3xl mx-auto">
              <form onSubmit={handleCompilePdf} className="flex flex-col sm:flex-row gap-2.5">
                <div className="flex-1 flex items-center bg-[var(--surface-solid)] border border-[var(--line-strong)] focus-within:border-[var(--accent)] focus-within:ring-4 focus-within:ring-[var(--accent-ring)] px-4 py-2.5 rounded-xl transition-all">
                  <FileText className="w-4 h-4 text-[var(--t-tertiary)] mr-2.5 flex-shrink-0" />
                  <input
                    id="scribd-url-input"
                    type="text"
                    placeholder="Paste a Scribd document link…"
                    className="bg-transparent border-none text-sm text-[var(--t-primary)] placeholder-[var(--t-placeholder)] focus:outline-none w-full"
                    value={scribdUrl}
                    onChange={(e) => setScribdUrl(e.target.value)}
                    required
                  />
                  {scribdUrl && (
                    <button
                      id="clear-url-btn"
                      type="button"
                      onClick={handleClear}
                      className="text-[var(--t-tertiary)] hover:text-[var(--t-primary)] p-1 rounded-full hover:bg-[var(--fill)] transition-colors cursor-pointer flex-shrink-0"
                      title="Clear"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    id="compile-pdf-btn"
                    type="submit"
                    disabled={isCompiling}
                    className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm px-5 py-2.5 rounded-full transition-all flex items-center gap-1.5 justify-center cursor-pointer whitespace-nowrap"
                    title="Download as PDF"
                  >
                    {isCompiling ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Working…
                      </>
                    ) : (
                      <>
                        <Play className="w-3.5 h-3.5 fill-white" />
                        Get PDF
                      </>
                    )}
                  </button>

                  <button
                    id="instant-live-view-btn"
                    type="button"
                    onClick={handleInstantLivePreview}
                    className="bg-[var(--fill)] hover:bg-[var(--fill-hover)] active:scale-[0.98] text-[var(--t-primary)] font-medium text-sm px-4 py-2.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    title="Read instantly without downloading"
                  >
                    <Eye className="w-4 h-4 text-[var(--accent-text)]" />
                    Read Now
                  </button>
                </div>
              </form>

              {/* Sample links */}
              <div className="flex flex-wrap items-center justify-between gap-3 mt-3.5">
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--t-secondary)]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)]"></span>
                  <span>Full quality — every page, no limits</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[var(--t-tertiary)] font-medium">Try:</span>
                  <button
                    id="preset-chem-btn"
                    type="button"
                    onClick={loadChemistrySample}
                    className="text-[11px] bg-[var(--surface-solid)] hover:bg-[var(--fill)] text-[var(--accent-text)] px-3 py-1 rounded-full border border-[var(--line-strong)] transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <BookOpen className="w-3 h-3" /> Chemistry Practical
                  </button>
                  <button
                    id="preset-organic-btn"
                    type="button"
                    onClick={loadReferenceSample}
                    className="text-[11px] bg-[var(--surface-solid)] hover:bg-[var(--fill)] text-[var(--accent-text)] px-3 py-1 rounded-full border border-[var(--line-strong)] transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <FileText className="w-3 h-3" /> Reference Doc
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Content stage */}
          <div className="flex-1 p-4 sm:p-6 overflow-hidden min-h-0 flex flex-col justify-center items-center">
            {/* 1. Progress */}
            {isCompiling && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-[var(--surface-solid)] border border-[var(--line)] p-8 rounded-3xl max-w-md w-full text-center shadow-[var(--shadow-card)] flex flex-col items-center gap-5"
              >
                <div className="relative flex items-center justify-center">
                  <div className="w-14 h-14 rounded-full border-[3px] border-[var(--fill)] border-t-[var(--accent)] animate-spin" />
                </div>

                <div>
                  <h3 className="font-semibold text-[17px] text-[var(--t-primary)] tracking-tight">Processing document</h3>
                  <p className="text-[13px] text-[var(--t-secondary)] mt-1 h-5 overflow-hidden">
                    {compilationStep}
                  </p>
                </div>

                <div className="w-full">
                  <div className="w-full bg-[var(--fill)] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--accent)] transition-all duration-300"
                      style={{ width: `${compilationProgress}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[11px] text-[var(--t-tertiary)] mt-2">
                    <span className="truncate max-w-[70%]">{documentTitle}</span>
                    <span className="font-medium text-[var(--t-primary)]">{compilationProgress}%</span>
                  </div>
                </div>

                {/* Live page thumbnail grid */}
                {pageThumbnails.length > 0 && (
                  <div className="w-full">
                    <div className="grid grid-cols-6 gap-1.5 max-h-44 overflow-y-auto pr-1">
                      {pageThumbnails.map((thumb, i) =>
                        thumb ? (
                          <motion.img
                            key={`page-${i}`}
                            initial={{ opacity: 0, scale: 0.85 }}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{ duration: 0.2 }}
                            src={thumb}
                            alt={`Page ${i + 1}`}
                            className="w-full aspect-[3/4] object-cover object-top rounded-md border border-[var(--line)] bg-white"
                          />
                        ) : (
                          <div
                            key={`pending-${i}`}
                            className="w-full aspect-[3/4] rounded-md border border-[var(--line)] bg-[var(--fill)] flex items-center justify-center text-[9px] font-medium text-[var(--t-tertiary)] animate-pulse"
                          >
                            {i + 1}
                          </div>
                        )
                      )}
                    </div>
                    <p className="text-[10px] text-[var(--t-tertiary)] text-center mt-2">
                      {pageThumbnails.filter(Boolean).length} of {pageThumbnails.length} pages retrieved
                    </p>
                  </div>
                )}
              </motion.div>
            )}

            {/* 2. Error */}
            {compilationError && !isCompiling && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-[var(--surface-solid)] border border-[var(--line)] p-7 rounded-3xl max-w-md text-center flex flex-col items-center gap-3.5 shadow-[var(--shadow-card)]"
              >
                <div className="w-12 h-12 rounded-full bg-[var(--danger-bg)] flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-[var(--danger)]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[15px] text-[var(--t-primary)]">Couldn’t process this document</h3>
                  <p className="text-[13px] text-[var(--t-secondary)] mt-1.5 leading-relaxed">{compilationError}</p>
                </div>
                <button
                  id="retry-compilation-btn"
                  onClick={() => handleCompilePdf()}
                  className="mt-1 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-[13px] font-medium px-5 py-2 rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Try Again
                </button>
              </motion.div>
            )}

            {/* 3. Empty state */}
            {!compiledPdfUrl && !isCompiling && !compilationError && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center max-w-md p-6 flex flex-col items-center gap-3"
              >
                <div className="w-16 h-16 rounded-2xl bg-[var(--surface-solid)] border border-[var(--line)] shadow-[var(--shadow-soft)] flex items-center justify-center mb-1">
                  <FileDown className="w-7 h-7 text-[var(--accent)]" strokeWidth={1.75} />
                </div>
                <h3 className="font-semibold text-[19px] text-[var(--t-primary)] tracking-tight">Ready when you are</h3>
                <p className="text-[13px] text-[var(--t-secondary)] leading-relaxed">
                  Paste a Scribd link above, then choose <span className="font-medium text-[var(--t-primary)]">Get PDF</span> to save
                  a copy, or <span className="font-medium text-[var(--t-primary)]">Read Now</span> to start reading instantly.
                </p>
              </motion.div>
            )}

            {/* 4. Result */}
            {compiledPdfUrl && !isCompiling && (
              <motion.div
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full h-full flex flex-col gap-3 min-h-0 max-w-5xl"
              >
                {/* Action bar */}
                <div className="bg-[var(--surface-solid)] border border-[var(--line)] p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center justify-between shadow-[var(--shadow-soft)]">
                  <div className="min-w-0 flex-1 text-center md:text-left">
                    <div className="flex items-center justify-center md:justify-start gap-1.5 mb-0.5">
                      <CheckCircle className="w-3.5 h-3.5 text-[var(--success)]" />
                      <span className="text-[11px] text-[var(--t-secondary)] font-medium uppercase tracking-wide">Ready</span>
                    </div>
                    <h3 className="font-semibold text-[15px] text-[var(--t-primary)] truncate">{documentTitle}</h3>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <a
                      id="direct-download-anchor"
                      href={compiledPdfUrl}
                      download={compiledPdfName}
                      className="px-5 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] active:scale-[0.98] text-white text-[13px] font-medium rounded-full transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </a>

                    {/* Segmented control */}
                    <div className="flex bg-[var(--fill)] p-0.5 rounded-lg">
                      <button
                        id="preview-mode-pdf-btn"
                        onClick={() => setPreviewMode('pdf')}
                        className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                          previewMode === 'pdf'
                            ? 'bg-[var(--surface-solid)] text-[var(--t-primary)] shadow-sm'
                            : 'text-[var(--t-secondary)] hover:text-[var(--t-primary)]'
                        }`}
                      >
                        <FileText className="w-3.5 h-3.5" />
                        PDF
                      </button>
                      <button
                        id="preview-mode-live-btn"
                        onClick={() => setPreviewMode('live')}
                        className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                          previewMode === 'live'
                            ? 'bg-[var(--surface-solid)] text-[var(--t-primary)] shadow-sm'
                            : 'text-[var(--t-secondary)] hover:text-[var(--t-primary)]'
                        }`}
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        Scribd
                      </button>
                    </div>

                    <button
                      id="recompile-btn"
                      onClick={() => handleCompilePdf()}
                      className="p-2 bg-[var(--fill)] hover:bg-[var(--fill-hover)] text-[var(--t-secondary)] hover:text-[var(--t-primary)] rounded-full transition-colors cursor-pointer"
                      title="Refresh"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Preview window */}
                <div className="flex-1 bg-[var(--surface-solid)] border border-[var(--line)] rounded-2xl overflow-hidden shadow-[var(--shadow-card)] relative min-h-0 flex flex-col">
                  <div className="bg-[var(--surface-2)] px-4 py-2 border-b border-[var(--line)] flex items-center justify-between text-xs text-[var(--t-secondary)]">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Eye className="w-3.5 h-3.5 text-[var(--accent)]" />
                      {previewMode === 'pdf' ? 'PDF Preview' : 'Scribd Reader'}
                    </span>
                    <a
                      href={previewMode === 'pdf' ? compiledPdfUrl || '#' : `https://www.scribd.com/document/${documentId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-[var(--t-primary)] flex items-center gap-1 text-[11px] transition-colors"
                    >
                      Open in new tab <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="flex-1 relative bg-[var(--surface-solid)]">
                    {previewMode === 'pdf' ? (
                      <iframe
                        id="pdf-preview-frame"
                        className="w-full h-full border-0 absolute inset-0"
                        src={`${compiledPdfUrl}#toolbar=1`}
                        title="PDF preview"
                      />
                    ) : (
                      <iframe
                        id="live-embed-preview-frame"
                        className="w-full h-full border-0 absolute inset-0"
                        src={`https://www.scribd.com/embeds/${documentId}/content?start_page=1&view_mode=scroll`}
                        allowFullScreen={true}
                        referrerPolicy="no-referrer"
                        title="Scribd reader preview"
                      />
                    )}
                  </div>
                </div>
              </motion.div>
            )}
          </div>
        </div>
      </main>

      {/* Install banner */}
      <AnimatePresence>
        {showInstallBanner && !isInstalled && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm z-50 bg-[var(--surface)] backdrop-blur-xl border border-[var(--line-strong)] rounded-2xl p-4 shadow-[var(--shadow-pop)]"
          >
            <button
              type="button"
              onClick={() => setShowInstallBanner(false)}
              className="text-[var(--t-tertiary)] hover:text-[var(--t-primary)] p-1 rounded-full hover:bg-[var(--fill)] transition-colors absolute top-3 right-3 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-start gap-3">
              <img src="/icons/icon-192.png" alt="App icon" className="w-11 h-11 rounded-[10px] object-cover shadow-sm flex-shrink-0" />
              <div className="flex-1 pr-5">
                <h3 className="font-semibold text-sm text-[var(--t-primary)]">Install HSC Practical Viewer</h3>
                <p className="text-[12px] text-[var(--t-secondary)] mt-0.5 leading-snug">
                  Add it to your {detectedPlatform.os} home screen for one-tap access.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-3.5">
              <button
                type="button"
                onClick={() => setShowInstallBanner(false)}
                className="text-[13px] text-[var(--accent-text)] hover:underline px-3 py-1.5 rounded-full transition-colors font-medium cursor-pointer"
              >
                Not now
              </button>
              <button
                id="install-now-popup-btn"
                type="button"
                onClick={handleTriggerInstall}
                className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium text-[13px] px-4 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer"
              >
                Install
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Manual install instructions */}
      <AnimatePresence>
        {showInstallGuideModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              className="bg-[var(--surface-solid)] rounded-3xl max-w-sm w-full p-6 shadow-2xl relative"
            >
              <button
                type="button"
                onClick={() => setShowInstallGuideModal(false)}
                className="absolute top-4 right-4 text-[var(--t-tertiary)] hover:text-[var(--t-primary)] p-1 rounded-full hover:bg-[var(--fill)] cursor-pointer transition-colors"
              >
                <X className="w-4.5 h-4.5" />
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[var(--accent-ring)] flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-[var(--accent)]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[15px] text-[var(--t-primary)]">Install this app</h3>
                  <p className="text-[11px] text-[var(--t-tertiary)]">{detectedPlatform.os} · {detectedPlatform.browser}</p>
                </div>
              </div>

              <div className="space-y-3 text-[13px] text-[var(--t-primary)]">
                {detectedPlatform.isIOS ? (
                  <div className="bg-[var(--fill)] p-3.5 rounded-2xl">
                    <h4 className="font-semibold mb-1 flex items-center gap-1.5 text-sm">
                      <Share className="w-4 h-4 text-[var(--accent)]" /> On iPhone & iPad
                    </h4>
                    <p className="text-[var(--t-secondary)] text-[12.5px] leading-relaxed">
                      Tap the <strong className="text-[var(--t-primary)]">Share</strong> button in Safari, then choose{' '}
                      <strong className="text-[var(--t-primary)]">Add to Home Screen</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="bg-[var(--fill)] p-3.5 rounded-2xl">
                    <h4 className="font-semibold mb-1 flex items-center gap-1.5 text-sm">
                      <Smartphone className="w-4 h-4 text-[var(--accent)]" /> One-tap install
                    </h4>
                    <p className="text-[var(--t-secondary)] text-[12.5px] leading-relaxed">
                      Tap <strong className="text-[var(--t-primary)]">Install</strong> and confirm when your browser asks. The app
                      will appear on your home screen.
                    </p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowInstallGuideModal(false)}
                className="mt-5 w-full bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-medium text-sm px-5 py-2.5 rounded-full transition-all cursor-pointer"
              >
                Got it
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
