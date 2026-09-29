# HSC Practical Viewer

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/NurMohammadDuari/hsc-practical-viewer)

A fast web app for viewing Scribd documents instantly and saving them as high-quality PDFs — built for HSC students who need practical guides, lab manuals, and reference documents without the clutter.

Paste a Scribd link, hit **Get PDF**, and every page is downloaded in parallel and compiled into a single PDF right in your browser. Or hit **Read Now** to open the live Scribd reader immediately.

## Features

- **PDF export** — downloads every page at original resolution and compiles them into one PDF client-side (nothing is stored on the server)
- **24-stream parallel download** — pages are fetched concurrently for maximum speed, with strict page ordering preserved
- **Instant reading** — embeds Scribd's own reader for immediate preview without waiting
- **CORS-free proxying** — the Express backend proxies Scribd CDN images so the browser can compile them into a PDF
- **Metadata caching** — document details are cached server-side for an hour, so repeat lookups are instant
- **Installable PWA** — works offline-capable and installs to your home screen on Android, iOS, and desktop

## How it works

1. The frontend extracts the document ID from your Scribd URL
2. The server resolves the document's title, page count, and page image URLs (with a three-strategy scraper: social-crawler headers, oEmbed API, and embed page)
3. The server probes whether original-resolution pages are publicly accessible
4. If yes, the browser downloads all pages through the image proxy and assembles them into a PDF with jsPDF
5. If the document is fully restricted, the app explains the limitation instead of pretending otherwise

## Running locally

**Prerequisites:** Node.js 18+, npm 9+

```bash
npm install
npm run dev
```

The app runs at `http://localhost:3000`.

### Production build

```bash
npm run build
npm start
```

## Tech stack

- **React 19** + **TypeScript**
- **Vite** + **Tailwind CSS v4**
- **Express** backend (metadata scraper + image proxy)
- **jsPDF** for client-side PDF compilation
- **Motion** for UI animation, **Lucide** for icons

## Project structure

```
├── server.ts          # Express backend: metadata API, image proxy, static serving
├── src/
│   ├── App.tsx        # UI, parallel downloader, client-side PDF compiler
│   ├── main.tsx       # React entry point
│   └── index.css      # Tailwind + typography
├── public/
│   ├── manifest.json  # PWA manifest
│   └── sw.js          # Service worker
└── index.html
```

## Notes

- This tool only exports documents whose pages Scribd already serves publicly; paywalled or fully restricted documents cannot (and will not) be extracted
- No documents, URLs, or PDFs are stored server-side — compilation happens entirely in your browser
- Document metadata is cached in memory for one hour

## License

MIT © [Nur Mohammad Duari](https://github.com/NurMohammadDuari)
