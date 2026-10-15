const express = require('express');
const path = require('path');
const fs = require('fs');
const https = require('https');
const { PORT, CHANNEL_ID, BOT_TOKEN, WEB_APP_URL } = require('./config');
const { getAllVideos, addVideo, getVideoByMessageId, getFilePath } = require('./videos');
const { startPolling, handleUpdate } = require('./bot');
const { setWebhook, deleteWebhook } = require('./telegram');
const {
  getBrowseVideos,
  getCategoryVideos,
  searchVideos,
  getDirectStream,
  markDeadVideo,
  CATEGORIES
} = require('./scraper');

const app = express();

// Full CORS support (allows frontend to be loaded from anywhere: localhost, Netlify, Vercel, Telegram)
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Request logger for visibility in terminal
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.url}`);
  next();
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Ensure cache directory exists for Telegram videos
const CACHE_DIR = path.join(__dirname, 'cache');
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ==========================================
// STREAMING & BROWSING APIS
// Zero ads, zero popups, zero Cloudflare turnstile
// Zero bandwidth on our VPS (client streams direct from CDN)
// ==========================================

// 1. Get Categories
app.get('/api/categories', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  res.json({ ok: true, categories: CATEGORIES });
});

// 2. Browse Videos
app.get('/api/browse', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const filter = req.query.filter || 'latest';
  const result = await getBrowseVideos(page, filter);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 3. Category Videos
app.get('/api/category/:slug', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const slug = req.params.slug;
  const result = await getCategoryVideos(slug, page);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 4. Search Videos
app.get('/api/search', async (req, res) => {
  const query = req.query.q || '';
  const page = parseInt(req.query.page, 10) || 1;
  if (!query.trim()) {
    return res.status(400).json({ ok: false, error: 'Empty search query' });
  }
  const result = await searchVideos(query, page);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 5. Get Direct Stream URL (Bypasses all popups, ads, and Turnstile)
app.get('/api/stream-info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ ok: false, error: 'Missing video url' });
  }
  const result = await getDirectStream(videoUrl);
  if (result.ok) {
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  }
  res.json(result);
});

// Report and blacklist dead/unplayable videos so they are removed from future listings
app.get('/api/report-dead', (req, res) => {
  const videoUrl = req.query.url;
  if (videoUrl) {
    markDeadVideo(videoUrl);
  }
  res.json({ ok: true });
});

const livePlaylistCache = new Map();

function setLivePlaylistCache(key, data, ttlMs = 3600000) {
  if (livePlaylistCache.size > 2000) {
    const oldestKey = livePlaylistCache.keys().next().value;
    livePlaylistCache.delete(oldestKey);
  }
  livePlaylistCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

app.get('/api/live.m3u8', async (req, res) => {
  const masterUrl = req.query.url;
  if (!masterUrl) return res.status(400).send('Missing url');

  const isIOS = req.query.ios === '1' || /iPhone|iPad|iPod/i.test(req.headers['user-agent'] || '');
  const cacheKey = `${masterUrl}:${isIOS ? 'ios' : 'direct'}`;

  const cached = livePlaylistCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400');
    return res.send(cached.data);
  }

  const fetchText = (targetUrl) => new Promise((resolve, reject) => {
    try {
      const parsed = new URL(targetUrl);
      https.get({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Referer': 'https://playmate.to/',
          'Origin': 'https://playmate.to'
        }
      }, clientRes => {
        let data = '';
        clientRes.on('data', chunk => { data += chunk; });
        clientRes.on('end', () => resolve(data));
      }).on('error', reject);
    } catch (e) {
      reject(e);
    }
  });

  try {
    const masterData = await fetchText(masterUrl);
    if (!masterData || !masterData.includes('#EXTM3U')) {
      return res.status(502).send('Invalid playlist from upstream host');
    }
    
    // Check if master playlist points to a subplaylist (e.g. index_avc_1280p.txt)
    const lines = masterData.split('\n');
    const subLine = lines.find(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('#');
    });

    let finalPlaylist = masterData;
    let basePlaylistUrl = masterUrl;

    if (subLine) {
      const subUrl = new URL(subLine.trim(), masterUrl).toString();
      basePlaylistUrl = subUrl;
      const subData = await fetchText(subUrl);
      if (subData.includes('#EXTINF')) {
        finalPlaylist = subData;
      }
    }

    // Rewrite all segment lines:
    // For iOS: route via /api/chunk to inject valid Content-Type: video/mp2t (avoids AVPlayer crash)
    // For PC/Android (Hls.js): direct CDN URLs for zero-latency streaming
    const rewritten = finalPlaylist.split('\n').map(line => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#')) {
        const fullSegUrl = new URL(trimmed, basePlaylistUrl).toString();
        if (isIOS) {
          return `/api/chunk?url=${encodeURIComponent(fullSegUrl)}`;
        }
        return fullSegUrl;
      }
      return line;
    }).join('\n');

    setLivePlaylistCache(cacheKey, rewritten, 3600000);

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=1800, s-maxage=3600, stale-while-revalidate=86400');
    res.send(rewritten);
  } catch (err) {
    console.error('[Playlist Error]:', err.message);
    res.status(502).send('Error generating playlist');
  }
});

// HLS Segment Proxy for Apple iOS Safari & Telegram WebApp (Fixes fake text/css MIME type)
app.get('/api/chunk', (req, res) => {
  const chunkUrl = req.query.url;
  if (!chunkUrl) return res.status(400).send('Missing url');

  try {
    const parsed = new URL(chunkUrl);
    const headers = {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'Referer': 'https://playmate.to/',
      'Origin': 'https://playmate.to'
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    https.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      headers
    }, upstreamRes => {
      // Guard against corrupted upstream 1-byte chunks: return 404 so player auto-skips to next segment
      const len = upstreamRes.headers['content-length'];
      if (upstreamRes.statusCode === 206 && len === '1') {
        return res.status(404).send('Corrupted upstream chunk');
      }

      res.status(upstreamRes.statusCode || 200);
      res.setHeader('Content-Type', 'video/mp2t');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range');
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
      if (upstreamRes.headers['content-range']) {
        res.setHeader('Content-Range', upstreamRes.headers['content-range']);
      }
      if (upstreamRes.headers['content-length']) {
        res.setHeader('Content-Length', upstreamRes.headers['content-length']);
      }
      upstreamRes.pipe(res);
    }).on('error', err => {
      console.error('[Chunk Proxy Error]:', err.message);
      if (!res.headersSent) res.status(502).send('Error proxying chunk');
    });
  } catch (err) {
    if (!res.headersSent) res.status(400).send('Invalid chunk URL');
  }
});

// 6. Thumbnail Proxy (Bypasses ISP image blocking & hotlink protection with 7-day Edge Cache)
app.get('/api/thumb', (req, res) => {
  const thumbUrl = req.query.url;
  if (!thumbUrl) return res.status(400).send('Missing url');

  try {
    const parsed = new URL(thumbUrl);
    https.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://desi52.watch/'
      }
    }, imgRes => {
      res.setHeader('Content-Type', imgRes.headers['content-type'] || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
      imgRes.pipe(res);
    }).on('error', err => {
      res.status(502).send('Error fetching thumbnail');
    });
  } catch (err) {
    res.status(400).send('Invalid thumbnail URL');
  }
});

// Telegram Bot Webhook Integration (Allows Bot to run on Vercel Serverless)
app.post('/api/telegram-webhook', async (req, res) => {
  try {
    const update = req.body;
    if (update && update.update_id) {
      await handleUpdate(update);
    }
  } catch (err) {
    console.error('[Telegram Webhook Error]:', err.message);
  }
  res.json({ ok: true });
});

app.get('/api/set-webhook', async (req, res) => {
  const webhookUrl = `${WEB_APP_URL}/api/telegram-webhook`;
  const result = await setWebhook(webhookUrl);
  res.json({ ok: true, webhookUrl, result });
});

// ==========================================
// TELEGRAM CHANNEL VIDEO APIS
// ==========================================

app.get('/api/videos', (req, res) => {
  const videos = getAllVideos();
  res.json({ ok: true, videos });
});

async function ensureCachedFile(video) {
  const cachedFilePath = path.join(CACHE_DIR, `${video.messageId}.mp4`);
  const tempPath = path.join(CACHE_DIR, `${video.messageId}.tmp`);

  if (fs.existsSync(cachedFilePath)) {
    const size = fs.statSync(cachedFilePath).size;
    if (size > 100000) return cachedFilePath;
  }

  let tgFilePath = video.filePath;
  if (!tgFilePath) {
    tgFilePath = await getFilePath(video.fileId);
    if (tgFilePath) {
      addVideo({ ...video, filePath: tgFilePath });
    }
  }

  if (!tgFilePath) {
    throw new Error('Could not resolve file path from Telegram');
  }

  console.log(`[Cache Manager] Downloading video #${video.messageId} to disk cache...`);
  const tgUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${tgFilePath}`;
  const response = await fetch(tgUrl);

  if (!response.ok) {
    throw new Error(`Telegram download failed with status ${response.status}`);
  }

  const buf = await response.arrayBuffer();
  fs.writeFileSync(tempPath, Buffer.from(buf));
  fs.renameSync(tempPath, cachedFilePath);

  console.log(`[Cache Manager] Video #${video.messageId} cached successfully (${fs.statSync(cachedFilePath).size} bytes)!`);
  return cachedFilePath;
}

app.get('/api/stream', async (req, res) => {
  const messageId = req.query.messageId;
  if (!messageId) return res.status(400).send('Missing messageId');

  const video = getVideoByMessageId(messageId);
  if (!video || !video.fileId) {
    return res.status(404).send('Video not found or missing fileId');
  }

  try {
    const filePath = await ensureCachedFile(video);
    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
      res.setHeader('Content-Length', chunksize);

      const stream = fs.createReadStream(filePath, { start, end });
      stream.pipe(res);
    } else {
      res.status(200);
      res.setHeader('Content-Length', fileSize);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    if (!res.headersSent) res.status(500).send('Streaming error: ' + err.message);
  }
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'online', channel: CHANNEL_ID });
});

// Global Process Crash Shields (Prevents sudden crash on unhandled network drops)
process.on('uncaughtException', (err) => {
  console.error('[CRASH SHIELD] Caught unhandled exception:', err.message);
});

process.on('unhandledRejection', (reason) => {
  console.error('[CRASH SHIELD] Caught unhandled rejection:', reason);
});

// Export app for serverless platforms (Vercel / Netlify)
module.exports = app;

// Only listen if executed directly (not when required as a module)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`[Server] Streaming & Telegram Portal running on http://localhost:${PORT}`);
    startPolling();
  });
}
