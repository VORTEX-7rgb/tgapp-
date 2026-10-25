# ? Fiziiii Instant Reels & Desi MMS Engine (Standalone Isolated Edition)

A 100% self-contained, blazing-fast, zero-VPS-bandwidth vertical video web app (TikTok / Instagram Reels style).

---

## ?? Project Structure

```
reels_standalone/
+-- server.js              # Ultra-lightweight standalone Express server (serves API & static UI)
+-- reels_catalog.js       # Master catalog aggregator & offset pagination logic
+-- nuditok_scraper.js     # Live client for 11,525+ TikTok trending reels (offset API v1)
+-- package.json           # Minimal dependencies (only requires express)
+-- data/
¦   +-- viralmms_fast_reels.json   # 308 verified ultra-fast Desi MMS reels (<= 16MB)
¦   +-- viralmms_catalog.json      # All 720 Desi MMS leaks
+-- public/
    +-- index.html         # Main Web App UI with Telegram WebApp SDK support
    +-- reels.html         # Direct reels player viewport
    +-- reels.css          # Deep Void (#08090D) & Ultraviolet (#8B5CF6) styling + 9:16 mobile frame
    +-- reels.js           # Sliding-window virtualization, 0.00s preloading, deduplication
```

---

## ?? Quick Start (Localhost)

### 1. Install Dependencies
```bash
cd reels_standalone
npm install
```

### 2. Start the Engine
```bash
npm start
# or
node server.js
```

### 3. Open in Browser
Visit: **[http://localhost:3000](http://localhost:3000)**

---

## ?? Configuration & Custom Port

To run on a different port (e.g. `8080` or `5000`):

```bash
# Windows PowerShell
$env:PORT=8080; node server.js

# Linux / macOS / Bash
PORT=8080 node server.js
```

---

## ?? API Endpoints

### 1. Get Live Reels Stream
```http
GET /api/reels?source={all|desi|nuditok}&page={pageNumber}&limit={count}
```

* `source=all`: Interleaved feed alternating 1 Fast Desi MMS + 1 Fast TikTok Reel.
* `source=desi`: 720 Desi MMS leaks (fastest <= 16MB prioritized first).
* `source=nuditok`: 11,525 global vertical TikTok reels via official API.
* `page`: 1, 2, 3...
* `limit`: Number of items per batch (default: 20).

### 2. Health Check
```http
GET /api/health
```

---

## ?? Engine Highlights

1. **Zero VPS Bandwidth**: All video chunks stream directly from upstream CDNs (`cdn2.nuditok.com`, `vms.viralmms.net`) via HTTP 206 Partial Content.
2. **Sliding-Window Virtualization**: Only active video and next 2 reels have network streams attached. Distant videos are unmounted, preventing memory leaks and socket exhaustion.
3. **True Offset Pagination**: Backend calculates exact offsets to guarantee zero repeating loops across thousands of swipes.
4. **No-Referrer Policy**: Prevents CDNs from identifying origin, eliminating HTTP 403 hotlink blocks.
