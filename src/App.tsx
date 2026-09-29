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
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { jsPDF } from 'jspdf';

export default function App() {
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

  // Compilation state
  const [isCompiling, setIsCompiling] = useState(false);
  const [compilationProgress, setCompilationProgress] = useState(0);
  const [compilationStep, setCompilationStep] = useState('');
  const [compiledPdfUrl, setCompiledPdfUrl] = useState<string | null>(null);
  const [compiledPdfName, setCompiledPdfName] = useState<string>('HSC-Practical.pdf');
  const [compilationError, setCompilationError] = useState<string | null>(null);
  const [documentTitle, setDocumentTitle] = useState<string>('Chemistry 2nd Practical — Sadat Rahman Sarthok');

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

        try {
          const img = await loadImage(proxiedUrl);
          pageSlots[p - 1] = img;
        } catch (_) {
          if (!pageImages || pageImages.length === 0) {
            const alternateUrl = `https://imgv2-2-f.scribdassets.com/img/document/${extractedId}/original/${secretKey}/${p}?v=1`;
            try {
              const img = await loadImage(`/api/proxy-image?url=${encodeURIComponent(alternateUrl)}`);
              pageSlots[p - 1] = img;
            } catch (_) {
              // Skip unavailable page
            }
          }
        }

        completedPagesCount++;
        const pct = 15 + Math.round((completedPagesCount / totalPagesToFetch) * 70);
        setCompilationProgress(pct);
        setCompilationStep(`Downloading ${completedPagesCount} of ${totalPagesToFetch} pages…`);
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
      setIsCompiling(false);
    } catch (err: any) {
      setCompilationError(err.message || 'Something went wrong while processing the document. Please try again.');
      setIsCompiling(false);
    }
  };

  // Load an image through the proxy as a decodable blob
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

  const handleClear = () => {
    setScribdUrl('');
    setCompiledPdfUrl(null);
    setCompilationError(null);
  };

  const loadChemistrySample = () => {
    setScribdUrl('https://www.scribd.com/document/835319016/Chemistry-2nd-Practical-By-Sadat-Rahman-Sarthok-GSC-HSC-25#from_embed');
    setDocumentId('835319016');
    setCompiledPdfUrl(null);
    setCompilationError(null);
  };

  const loadReferenceSample = () => {
    setScribdUrl('https://www.scribd.com/document/423214959/Table-of-FIDIC-Cases-PDF');
    setDocumentId('423214959');
    setCompiledPdfUrl(null);
    setCompilationError(null);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#f5f5f7] text-[#1d1d1f] overflow-hidden">
      {/* Header */}
      <header className="bg-white/70 backdrop-blur-xl border-b border-black/[0.06] px-4 sm:px-6 py-3 flex-shrink-0 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <img src="/pwa_icon.jpg" alt="App icon" className="w-9 h-9 rounded-[10px] object-cover shadow-sm" />
          <div className="text-left">
            <h1 className="font-semibold text-[15px] sm:text-base tracking-tight text-[#1d1d1f]">
              HSC Practical Viewer
            </h1>
            <p className="text-[11px] text-[#6e6e73] leading-tight">
              View any Scribd document, or save it as a PDF
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isInstalled && (
            <button
              id="pwa-install-header-btn"
              type="button"
              onClick={handleTriggerInstall}
              className="bg-[#0071e3] hover:bg-[#0077ed] active:scale-[0.97] text-white font-medium text-xs px-4 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer"
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
          <div className="bg-white/60 backdrop-blur-xl border-b border-black/[0.06] p-4 sm:p-5">
            <div className="max-w-3xl mx-auto">
              <form onSubmit={handleCompilePdf} className="flex flex-col sm:flex-row gap-2.5">
                <div className="flex-1 flex items-center bg-white border border-black/10 focus-within:border-[#0071e3] focus-within:ring-4 focus-within:ring-[#0071e3]/10 px-4 py-2.5 rounded-xl transition-all">
                  <FileText className="w-4 h-4 text-[#86868b] mr-2.5 flex-shrink-0" />
                  <input
                    id="scribd-url-input"
                    type="text"
                    placeholder="Paste a Scribd document link…"
                    className="bg-transparent border-none text-sm text-[#1d1d1f] placeholder-[#a1a1a6] focus:outline-none w-full"
                    value={scribdUrl}
                    onChange={(e) => setScribdUrl(e.target.value)}
                    required
                  />
                  {scribdUrl && (
                    <button
                      id="clear-url-btn"
                      type="button"
                      onClick={handleClear}
                      className="text-[#86868b] hover:text-[#1d1d1f] p-1 rounded-full hover:bg-black/5 transition-colors cursor-pointer flex-shrink-0"
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
                    className="bg-[#0071e3] hover:bg-[#0077ed] active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-sm px-5 py-2.5 rounded-full transition-all flex items-center gap-1.5 justify-center cursor-pointer whitespace-nowrap"
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
                    className="bg-black/[0.04] hover:bg-black/[0.08] active:scale-[0.98] text-[#1d1d1f] font-medium text-sm px-4 py-2.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
                    title="Read instantly without downloading"
                  >
                    <Eye className="w-4 h-4 text-[#0066cc]" />
                    Read Now
                  </button>
                </div>
              </form>

              {/* Sample links */}
              <div className="flex flex-wrap items-center justify-between gap-3 mt-3.5">
                <div className="flex items-center gap-1.5 text-[11px] text-[#6e6e73]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#30d158]"></span>
                  <span>Full quality — every page, no limits</span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-[#86868b] font-medium">Try:</span>
                  <button
                    id="preset-chem-btn"
                    type="button"
                    onClick={loadChemistrySample}
                    className="text-[11px] bg-white hover:bg-black/[0.03] text-[#0066cc] px-3 py-1 rounded-full border border-black/[0.08] transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <BookOpen className="w-3 h-3" /> Chemistry Practical
                  </button>
                  <button
                    id="preset-organic-btn"
                    type="button"
                    onClick={loadReferenceSample}
                    className="text-[11px] bg-white hover:bg-black/[0.03] text-[#0066cc] px-3 py-1 rounded-full border border-black/[0.08] transition-all flex items-center gap-1 cursor-pointer"
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
                className="bg-white border border-black/[0.06] p-8 rounded-3xl max-w-md w-full text-center shadow-[0_8px_30px_rgba(0,0,0,0.06)] flex flex-col items-center gap-5"
              >
                <div className="relative flex items-center justify-center">
                  <div className="w-14 h-14 rounded-full border-[3px] border-black/[0.06] border-t-[#0071e3] animate-spin" />
                </div>

                <div>
                  <h3 className="font-semibold text-[17px] text-[#1d1d1f] tracking-tight">Processing document</h3>
                  <p className="text-[13px] text-[#6e6e73] mt-1 h-5 overflow-hidden">
                    {compilationStep}
                  </p>
                </div>

                <div className="w-full">
                  <div className="w-full bg-black/[0.06] h-1.5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#0071e3] transition-all duration-300"
                      style={{ width: `${compilationProgress}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[11px] text-[#86868b] mt-2">
                    <span>{documentTitle}</span>
                    <span className="font-medium text-[#1d1d1f]">{compilationProgress}%</span>
                  </div>
                </div>
              </motion.div>
            )}

            {/* 2. Error */}
            {compilationError && !isCompiling && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white border border-black/[0.06] p-7 rounded-3xl max-w-md text-center flex flex-col items-center gap-3.5 shadow-[0_8px_30px_rgba(0,0,0,0.06)]"
              >
                <div className="w-12 h-12 rounded-full bg-[#ff3b30]/10 flex items-center justify-center">
                  <AlertCircle className="w-6 h-6 text-[#ff3b30]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[15px] text-[#1d1d1f]">Couldn’t process this document</h3>
                  <p className="text-[13px] text-[#6e6e73] mt-1.5 leading-relaxed">{compilationError}</p>
                </div>
                <button
                  id="retry-compilation-btn"
                  onClick={() => handleCompilePdf()}
                  className="mt-1 bg-[#0071e3] hover:bg-[#0077ed] text-white text-[13px] font-medium px-5 py-2 rounded-full transition-colors flex items-center gap-1.5 cursor-pointer"
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
                <div className="w-16 h-16 rounded-2xl bg-white border border-black/[0.06] shadow-[0_4px_16px_rgba(0,0,0,0.04)] flex items-center justify-center mb-1">
                  <FileDown className="w-7 h-7 text-[#0071e3]" strokeWidth={1.75} />
                </div>
                <h3 className="font-semibold text-[19px] text-[#1d1d1f] tracking-tight">Ready when you are</h3>
                <p className="text-[13px] text-[#6e6e73] leading-relaxed">
                  Paste a Scribd link above, then choose <span className="font-medium text-[#1d1d1f]">Get PDF</span> to save
                  a copy, or <span className="font-medium text-[#1d1d1f]">Read Now</span> to start reading instantly.
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
                <div className="bg-white border border-black/[0.06] p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-center justify-between shadow-[0_4px_16px_rgba(0,0,0,0.04)]">
                  <div className="min-w-0 flex-1 text-center md:text-left">
                    <div className="flex items-center justify-center md:justify-start gap-1.5 mb-0.5">
                      <CheckCircle className="w-3.5 h-3.5 text-[#30d158]" />
                      <span className="text-[11px] text-[#6e6e73] font-medium uppercase tracking-wide">Ready</span>
                    </div>
                    <h3 className="font-semibold text-[15px] text-[#1d1d1f] truncate">{documentTitle}</h3>
                  </div>

                  <div className="flex flex-wrap items-center justify-center gap-2.5">
                    <a
                      id="direct-download-anchor"
                      href={compiledPdfUrl}
                      download={compiledPdfName}
                      className="px-5 py-2 bg-[#0071e3] hover:bg-[#0077ed] active:scale-[0.98] text-white text-[13px] font-medium rounded-full transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      Download
                    </a>

                    {/* Segmented control */}
                    <div className="flex bg-black/[0.05] p-0.5 rounded-lg">
                      <button
                        id="preview-mode-pdf-btn"
                        onClick={() => setPreviewMode('pdf')}
                        className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                          previewMode === 'pdf'
                            ? 'bg-white text-[#1d1d1f] shadow-sm'
                            : 'text-[#6e6e73] hover:text-[#1d1d1f]'
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
                            ? 'bg-white text-[#1d1d1f] shadow-sm'
                            : 'text-[#6e6e73] hover:text-[#1d1d1f]'
                        }`}
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        Scribd
                      </button>
                    </div>

                    <button
                      id="recompile-btn"
                      onClick={() => handleCompilePdf()}
                      className="p-2 bg-black/[0.04] hover:bg-black/[0.08] text-[#6e6e73] hover:text-[#1d1d1f] rounded-full transition-colors cursor-pointer"
                      title="Refresh"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {/* Preview window */}
                <div className="flex-1 bg-white border border-black/[0.06] rounded-2xl overflow-hidden shadow-[0_8px_30px_rgba(0,0,0,0.06)] relative min-h-0 flex flex-col">
                  <div className="bg-[#f5f5f7] px-4 py-2 border-b border-black/[0.06] flex items-center justify-between text-xs text-[#6e6e73]">
                    <span className="flex items-center gap-1.5 font-medium">
                      <Eye className="w-3.5 h-3.5 text-[#0071e3]" />
                      {previewMode === 'pdf' ? 'PDF Preview' : 'Scribd Reader'}
                    </span>
                    <a
                      href={previewMode === 'pdf' ? compiledPdfUrl || '#' : `https://www.scribd.com/document/${documentId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-[#1d1d1f] flex items-center gap-1 text-[11px] transition-colors"
                    >
                      Open in new tab <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>

                  <div className="flex-1 relative bg-white">
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
            className="fixed bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm z-50 bg-white/90 backdrop-blur-xl border border-black/[0.08] rounded-2xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.18)]"
          >
            <button
              type="button"
              onClick={() => setShowInstallBanner(false)}
              className="text-[#86868b] hover:text-[#1d1d1f] p-1 rounded-full hover:bg-black/5 transition-colors absolute top-3 right-3 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex items-start gap-3">
              <img src="/pwa_icon.jpg" alt="App icon" className="w-11 h-11 rounded-[10px] object-cover shadow-sm flex-shrink-0" />
              <div className="flex-1 pr-5">
                <h3 className="font-semibold text-sm text-[#1d1d1f]">Install HSC Practical Viewer</h3>
                <p className="text-[12px] text-[#6e6e73] mt-0.5 leading-snug">
                  Add it to your {detectedPlatform.os} home screen for one-tap access.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 mt-3.5">
              <button
                type="button"
                onClick={() => setShowInstallBanner(false)}
                className="text-[13px] text-[#0066cc] hover:underline px-3 py-1.5 rounded-full transition-colors font-medium cursor-pointer"
              >
                Not now
              </button>
              <button
                id="install-now-popup-btn"
                type="button"
                onClick={handleTriggerInstall}
                className="bg-[#0071e3] hover:bg-[#0077ed] text-white font-medium text-[13px] px-4 py-1.5 rounded-full flex items-center gap-1.5 transition-all cursor-pointer"
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
              className="bg-white rounded-3xl max-w-sm w-full p-6 shadow-2xl relative"
            >
              <button
                type="button"
                onClick={() => setShowInstallGuideModal(false)}
                className="absolute top-4 right-4 text-[#86868b] hover:text-[#1d1d1f] p-1 rounded-full hover:bg-black/5 cursor-pointer transition-colors"
              >
                <X className="w-4.5 h-4.5" />
              </button>

              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-[#0071e3]/10 flex items-center justify-center">
                  <Smartphone className="w-5 h-5 text-[#0071e3]" />
                </div>
                <div>
                  <h3 className="font-semibold text-[15px] text-[#1d1d1f]">Install this app</h3>
                  <p className="text-[11px] text-[#86868b]">{detectedPlatform.os} · {detectedPlatform.browser}</p>
                </div>
              </div>

              <div className="space-y-3 text-[13px] text-[#1d1d1f]">
                {detectedPlatform.isIOS ? (
                  <div className="bg-[#f5f5f7] p-3.5 rounded-2xl">
                    <h4 className="font-semibold mb-1 flex items-center gap-1.5 text-sm">
                      <Share className="w-4 h-4 text-[#0071e3]" /> On iPhone & iPad
                    </h4>
                    <p className="text-[#6e6e73] text-[12.5px] leading-relaxed">
                      Tap the <strong className="text-[#1d1d1f]">Share</strong> button in Safari, then choose{' '}
                      <strong className="text-[#1d1d1f]">Add to Home Screen</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="bg-[#f5f5f7] p-3.5 rounded-2xl">
                    <h4 className="font-semibold mb-1 flex items-center gap-1.5 text-sm">
                      <Smartphone className="w-4 h-4 text-[#0071e3]" /> One-tap install
                    </h4>
                    <p className="text-[#6e6e73] text-[12.5px] leading-relaxed">
                      Tap <strong className="text-[#1d1d1f]">Install</strong> and confirm when your browser asks. The app
                      will appear on your home screen.
                    </p>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowInstallGuideModal(false)}
                className="mt-5 w-full bg-[#0071e3] hover:bg-[#0077ed] text-white font-medium text-sm px-5 py-2.5 rounded-full transition-all cursor-pointer"
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
