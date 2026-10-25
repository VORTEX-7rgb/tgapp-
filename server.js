const coWatch = require('./co_watch_engine');
const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const { Transform, Duplex } = require('stream');

// Crash Shield: Prevent unhandled upstream socket resets or rejections from terminating server
process.on('uncaughtException', (err) => {
  console.error('[CRASH SHIELD] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('[CRASH SHIELD] Unhandled Rejection:', (reason && reason.message) || reason);
});

// High-performance persistent keep-alive connection pools for proxying upstream chunks
const proxyAgentHttps = new https.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 32,
  keepAliveMsecs: 60000,
  timeout: 15000
});
const proxyAgentHttp = new http.Agent({
  keepAlive: true,
  maxSockets: 64,
  maxFreeSockets: 32,
  keepAliveMsecs: 60000,
  timeout: 15000
});

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
  httpGet,
  USER_AGENT,
  CATEGORIES
} = require('./scraper');
const {
  getVerifiedBrowse,
  getVerifiedCategory,
  getLocalCatalog,
  auditAndPopulateCatalog
} = require('./verifier');
const {
  CATEGORIES: KMB_CATEGORIES,
  getBrowseVideos: getKmbBrowse,
  getCategoryVideos: getKmbCategory,
  searchVideos: searchKmbVideos,
  getVideoById: getKmbVideoById,
  getVideoByUrl: getKmbVideoByUrl,
  getRelatedVideos: getKmbRelated,
  syncCatalog: syncKmbCatalog,
  isSyncing: isKmbSyncing,
  getCatalogSize: getKmbCatalogSize
} = require('./kamababa_catalog');
const {
  CATEGORIES: VMMS_CATEGORIES,
  getBrowseVideos: getVmmsBrowse,
  getCategoryVideos: getVmmsCategory,
  searchVideos: searchVmmsVideos,
  getVideoById: getVmmsVideoById,
  getVideoByUrl: getVmmsVideoByUrl,
  getRelatedVideos: getVmmsRelated,
  syncCatalog: syncVmmsCatalog,
  isSyncing: isVmmsSyncing,
  getCatalogSize: getVmmsCatalogSize
} = require('./viralmms_catalog');

const { fetchPixDpi } = require('./upskirt_scraper');

const {
  CATEGORIES: UT_CATEGORIES,
  getUtBrowse,
  searchUtVideos,
  getOrResolveUtStream,
  getRelatedVideos: getUtRelated,
  syncCatalog: syncUtCatalog,
  isSyncing: isUtSyncing
} = require('./upskirt_catalog');

const {
  CATEGORIES: SKBJ_CATEGORIES,
  getBrowseVideos: getSkbjBrowse,
  getCategoryVideos: getSkbjCategory,
  searchVideos: searchSkbjVideos,
  getVideoById: getSkbjVideoById,
  getRelatedVideos: getSkbjRelated,
  getCatalogSize: getSkbjCatalogSize
} = require('./sexkbj_catalog');
const {
  CATEGORIES: PB_CATEGORIES,
  getBrowseVideos: getPbBrowse,
  getCategoryVideos: getPbCategory,
  searchVideos: searchPbVideos,
  getVideoById: getPbVideoById,
  getCatalogSize: getPbCatalogSize
} = require('./pornbusy_catalog');
const { getReels, getPersonalizedFeed, recordTelemetry } = require('./reels_catalog');
const cinemaRecommender = require('./cinema_recommender');

function refreshCinemaCatalog() {
  try {
    const kmb = (typeof getKmbBrowse === 'function') ? (getKmbBrowse(1, 99999).videos || []) : [];
    const vmms = (typeof getVmmsBrowse === 'function') ? (getVmmsBrowse(1, 99999).videos || []) : [];
    const pb = (typeof getPbBrowse === 'function') ? (getPbBrowse(1, 99999).videos || []) : [];
    const skbj = (typeof getSkbjBrowse === 'function') ? (getSkbjBrowse(1, 99999).videos || []) : [];
    const ut = (typeof getUtBrowse === 'function') ? (getUtBrowse(1, 99999).videos || []) : [];
    cinemaRecommender.initCinemaCatalog([...kmb, ...vmms, ...pb, ...skbj, ...ut]);
  } catch (err) {
    console.error('[Cinema Recommender Refresh Error]:', err.message);
  }
}
refreshCinemaCatalog();

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

app.use(express.json({ limit: '256kb' }));
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
// REELS & SHORTS API (TIER 1 PLATFORMS)
// OnlyTik + NudiTok + Desi MMS Smartphone Leaks
// Zero VPS Bandwidth - Direct Client CDN Stream
// ==========================================

// Personalized Dopamine Feed Endpoint
app.post('/api/reels/feed', async (req, res) => {
  try {
    const {
      source = (req.body && req.body.category) || 'trending',
      limit = 20,
      desiRatio = 0.5,
      topTags = {},
      dislikedTags = [],
      recentSeenIds = [],
      sessionSeed = Date.now()
    } = req.body || {};

    const data = await getPersonalizedFeed({
      source,
      limit,
      desiRatio,
      topTags,
      dislikedTags,
      recentSeenIds,
      sessionSeed
    });
    res.json(data);
  } catch (err) {
    console.error('[API POST /api/reels/feed Error]:', err.message);
    res.status(500).json({ ok: false, error: err.message, reels: [] });
  }
});

// Crowd Telemetry Ingestion Endpoint
app.post('/api/reels/telemetry', (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const updated = recordTelemetry(events);
    res.json({ ok: true, processed: updated });
  } catch (err) {
    console.error('[API POST /api/reels/telemetry Error]:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/reels', async (req, res) => {
  const source = req.query.source || 'all';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 15;
  try {
    const data = await getReels(source, page, limit);
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300');
    res.json(data);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ==========================================
// STREAMING & BROWSING APIS
// Zero ads, zero popups, zero Cloudflare turnstile
// Zero bandwidth on our VPS (client streams direct from CDN)
// ==========================================

// 1. Get Categories
app.get('/api/categories', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  res.json({ ok: true, categories: KMB_CATEGORIES });
});

// 2. Browse Videos (Serves 100% pre-verified, zero-broken, fast Playmate videos instantly)
app.get('/api/browse', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = getKmbBrowse(page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 3. Category Videos (Serves direct MP4 KamaBaba library - 0 VPS bandwidth)
app.get('/api/category/:slug', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const slug = req.params.slug;
  const result = getKmbCategory(slug, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 4. Search Videos (Serves direct MP4 KamaBaba library - 0 VPS bandwidth)
app.get('/api/search', (req, res) => {
  const query = (req.query.q || '').trim();
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = searchKmbVideos(query, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

app.get('/api/stream-info', async (req, res) => {
  const videoUrl = req.query.url;
  if (!videoUrl) {
    return res.status(400).json({ ok: false, error: 'Missing video url' });
  }

  // Fast-path: Look up pre-verified stream (0ms response)
  const catalog = getLocalCatalog();
  const cachedVideo = catalog.find(v => v.url === videoUrl);
  if (cachedVideo && cachedVideo.rawUrl && cachedVideo.streamUrl) {
    res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=86400, stale-while-revalidate=86400');
    return res.json({
      ok: true,
      type: 'hls',
      streamUrl: cachedVideo.streamUrl,
      rawUrl: cachedVideo.rawUrl,
      poster: cachedVideo.poster || cachedVideo.thumb,
      title: cachedVideo.title
    });
  }

  const result = await getDirectStream(videoUrl);
  if (result.ok) {
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400');
  }
  res.json(result);
});

// 6. Trigger Background Catalog Audit
app.get('/api/sync-catalog', (req, res) => {
  res.json({ ok: true, message: 'Auditor scanning and verifying new videos in background' });
  auditAndPopulateCatalog(3, 40).catch(err => console.error('[Auditor Error]:', err.message));
});

// Report and blacklist dead/unplayable videos so they are removed from future listings
app.get('/api/report-dead', (req, res) => {
  const videoUrl = req.query.url;
  if (videoUrl) {
    markDeadVideo(videoUrl);
  }
  res.json({ ok: true });
});

// ==========================================
// MYKAMABABA DIRECT MP4 ZERO-BANDWIDTH APIS
// Fast, microsecond RAM responses, 0 VPS bandwidth
// ==========================================

// 1. KamaBaba Categories
app.get('/api/kmb/categories', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  res.json({ ok: true, categories: KMB_CATEGORIES });
});

// 2. KamaBaba Browse (Instant RAM response with streamUrl attached)
app.get('/api/kmb/browse', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = getKmbBrowse(page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 3. KamaBaba Category (Filtered RAM response with streamUrl attached)
app.get('/api/kmb/category/:slug', (req, res) => {
  const slug = req.params.slug;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = getKmbCategory(slug, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 4. KamaBaba Search
app.get('/api/kmb/search', (req, res) => {
  const query = req.query.q || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = searchKmbVideos(query, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 5. KamaBaba Stream Info (0ms fast path for direct MP4)
app.get('/api/kmb/stream-info', (req, res) => {
  const id = req.query.id;
  const url = req.query.url;
  const video = (id && getKmbVideoById(id)) || (url && getKmbVideoByUrl(url));

  if (video && video.streamUrl) {
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
    return res.json({
      ok: true,
      type: 'mp4',
      streamUrl: video.streamUrl,
      rawUrl: video.streamUrl,
      poster: video.poster,
      thumb: video.thumb,
      title: video.title
    });
  }

  res.status(404).json({ ok: false, error: 'Video not found in catalog' });
});

// 6. KamaBaba Catalog Background Sync
app.get('/api/kmb/sync', (req, res) => {
  const pages = parseInt(req.query.pages, 10) || 2;
  const limit = parseInt(req.query.limit, 10) || 25;

  if (isKmbSyncing()) {
    return res.json({ ok: false, message: 'Sync already in progress (Mutex Locked)' });
  }

  res.json({ ok: true, message: `Sync initiated in background for ${pages} pages` });
  syncKmbCatalog(pages, limit).catch(err => console.error('[KMB Sync API Error]:', err.message));
});

// ==========================================
// VIRALMMS DIRECT MP4 ZERO-BANDWIDTH APIS
// Fast, microsecond RAM responses, 0 VPS bandwidth
// ==========================================

// 1. ViralMMS Categories
app.get('/api/vmms/categories', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  res.json({ ok: true, categories: VMMS_CATEGORIES });
});

// 2. ViralMMS Browse (Instant RAM response with direct streamUrl)
app.get('/api/vmms/browse', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = getVmmsBrowse(page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 3. ViralMMS Category (Filtered RAM response with direct streamUrl)
app.get('/api/vmms/category/:slug', (req, res) => {
  const slug = req.params.slug;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = getVmmsCategory(slug, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 4. ViralMMS Search
app.get('/api/vmms/search', (req, res) => {
  const query = req.query.q || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = searchVmmsVideos(query, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 5. ViralMMS Stream Info (0ms fast path for direct MP4)
app.get('/api/vmms/stream-info', (req, res) => {
  const id = req.query.id;
  const url = req.query.url;
  const video = (id && getVmmsVideoById(id)) || (url && getVmmsVideoByUrl(url));

  if (video && video.streamUrl) {
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
    return res.json({
      ok: true,
      type: 'mp4',
      streamUrl: video.streamUrl,
      rawUrl: video.streamUrl,
      poster: video.poster,
      thumb: video.thumb,
      title: video.title
    });
  }

  res.status(404).json({ ok: false, error: 'Video not found in ViralMMS catalog' });
});

// 6. ViralMMS Background Sync
app.get('/api/vmms/sync', (req, res) => {
  if (isVmmsSyncing()) {
    return res.json({ ok: false, message: 'Sync already in progress' });
  }

  res.json({ ok: true, message: 'Sync initiated in background' });
  syncVmmsCatalog().catch(err => console.error('[VMMS Sync API Error]:', err.message));
});




// ==========================================
// UPSKIRT.TV ENDPOINTS
// ==========================================

// 1. Upskirt Categories
app.get('/api/ut/categories', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  res.json({ ok: true, categories: UT_CATEGORIES });
});

// 2. Upskirt Browse
app.get('/api/ut/browse', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 24;
  const result = getUtBrowse(page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 3. Upskirt Search
app.get('/api/ut/search', (req, res) => {
  const query = req.query.q || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 24;
  const result = searchUtVideos(query, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

class DpiSplitterStream extends Transform {
  constructor() {
    super();
    this.first = true;
  }
  _transform(chunk, enc, cb) {
    if (this.first && chunk.length > 30) {
      this.first = false;
      this.push(chunk.slice(0, 30));
      setTimeout(() => {
        this.push(chunk.slice(30));
        cb();
      }, 40);
    } else {
      this.push(chunk);
      cb();
    }
  }
}

const UT_STREAM_IPS = [
  '79.127.138.15', '79.127.138.28', '79.127.138.21', '79.127.138.18',
  '79.127.235.9', '79.127.213.228', '79.127.235.3', '79.127.235.5'
];

// In-Memory Token Vault: Max 5,000 items (~1.5 MB RAM total)
const utTokenVault = new Map();

function setUtTokenInVault(numericId, streamUrl, expiresAt) {
  if (utTokenVault.size > 5000) {
    const firstKey = utTokenVault.keys().next().value;
    utTokenVault.delete(firstKey);
  }
  utTokenVault.set(String(numericId), {
    streamUrl,
    expiresAt: expiresAt || (Math.floor(Date.now() / 1000) + 7000)
  });
}

function getUtTokenFromVault(numericId) {
  const entry = utTokenVault.get(String(numericId));
  if (!entry) return null;
  const now = Math.floor(Date.now() / 1000);
  if (entry.expiresAt && (entry.expiresAt - now < 180)) {
    utTokenVault.delete(String(numericId));
    return null; // Expiring soon, renew fresh
  }
  return entry.streamUrl;
}

// Background Pre-Warm Endpoint: 0ms Click-to-Play
app.get('/api/ut/prewarm', async (req, res) => {
  const numericId = (req.query.id || req.query.numericId || '').replace(/^ut-/, '');
  if (!numericId) return res.json({ ok: false });

  const cached = getUtTokenFromVault(numericId);
  if (cached) return res.json({ ok: true, cached: true });

  try {
    const video = await getOrResolveUtStream(numericId);
    const upstreamUrl = (video && video.upstreamUrl && video.upstreamUrl.startsWith('http'))
      ? video.upstreamUrl
      : (video && video.streamUrl && video.streamUrl.startsWith('http') ? video.streamUrl : null);
    if (upstreamUrl) {
      setUtTokenInVault(numericId, upstreamUrl, video.expiresAt);
      return res.json({ ok: true, prewarmed: true });
    }
  } catch (_) {}
  res.json({ ok: false });
});

// 4. Upskirt Stream Info (Provides permanent virtual URLs + quality switches)
app.get('/api/ut/stream-info', async (req, res) => {
  const id = req.query.id || req.query.numericId;
  const force = req.query.force === '1' || req.query.force === 'true';
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id or numericId' });

  const cleanNumeric = String(id).replace(/^ut-/, '');
  const permanentStreamUrl = `/api/ut/stream/${cleanNumeric}.mp4`;

  try {
    const video = await getOrResolveUtStream(cleanNumeric, force);
    const upstreamUrl = (video && video.upstreamUrl && video.upstreamUrl.startsWith('http'))
      ? video.upstreamUrl
      : (video && video.streamUrl && video.streamUrl.startsWith('http') ? video.streamUrl : null);
    if (upstreamUrl) {
      setUtTokenInVault(cleanNumeric, upstreamUrl, video.expiresAt);
    }
    if (video) {

      const qualityUrls = {
        '1080p': `/api/ut/stream/${cleanNumeric}.mp4?q=1080`,
        '480p': `/api/ut/stream/${cleanNumeric}.mp4?q=480`
      };

      res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');
      return res.json({
        ok: true,
        type: 'mp4',
        id: video.id || `ut-${cleanNumeric}`,
        numericId: cleanNumeric,
        slug: video.slug || '',
        streamUrl: permanentStreamUrl,
        directStreamUrl: permanentStreamUrl,
        qualityUrls,
        defaultQuality: '1080p',
        master: video.master || '',
        thumb: video.thumb || '',
        preview: video.preview || '',
        duration: video.duration || '',
        title: video.title || '',
        expiresAt: video.expiresAt
      });
    }

    // Fallback: Return permanent virtual stream URL regardless
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.json({
      ok: true,
      type: 'mp4',
      id: `ut-${cleanNumeric}`,
      numericId: cleanNumeric,
      streamUrl: permanentStreamUrl,
      directStreamUrl: permanentStreamUrl
    });
  } catch (err) {
    console.error('[Upskirt Stream Info Error]:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Permanent Streaming Proxy: Zero-RAM backpressure pipe + auto-healing
app.get(['/api/ut/stream/:id.mp4', '/api/ut/stream/:id', '/api/ut/stream'], async (req, res) => {
  const numericId = (req.params.id || req.query.id || req.query.numericId || '').replace(/^ut-/, '').replace(/\.mp4$/, '');
  let targetUrl = req.query.url;

  if (!targetUrl && numericId) {
    targetUrl = getUtTokenFromVault(numericId);
    if (!targetUrl) {
      try {
        const video = await getOrResolveUtStream(numericId);
        const resolvedUpstream = (video && video.upstreamUrl && video.upstreamUrl.startsWith('http'))
          ? video.upstreamUrl
          : (video && video.streamUrl && video.streamUrl.startsWith('http') ? video.streamUrl : null);
        if (resolvedUpstream) {
          targetUrl = resolvedUpstream;
          setUtTokenInVault(numericId, resolvedUpstream, video.expiresAt);
        }
      } catch (e) {
        return res.status(502).send('Error resolving video stream');
      }
    }
  }

  if (!targetUrl) {
    return res.status(404).send('Stream URL not found');
  }

  const streamFromUpstream = (videoUrl, isRetry = false) => {
    try {
      const parsed = new URL(videoUrl);
      const ip = UT_STREAM_IPS[Math.floor(Math.random() * UT_STREAM_IPS.length)];

      let clientDisconnected = false;
      let raw = null;
      let tlsSocket = null;

      const cleanup = () => {
        try { if (tlsSocket) tlsSocket.destroy(); } catch (_) {}
        try { if (raw) raw.destroy(); } catch (_) {}
      };

      // VPS Bandwidth Guard: If client closes tab or pauses, instantly kill upstream connection!
      req.on('close', () => {
        clientDisconnected = true;
        cleanup();
      });

      raw = net.connect(443, ip, () => {
        if (clientDisconnected) return cleanup();
        const splitter = new DpiSplitterStream();
        splitter.pipe(raw);
        const duplex = new Duplex({ read() {}, write(c, e, cb) { splitter.write(c, e, cb); } });
        raw.on('data', c => duplex.push(c));
        raw.on('end', () => duplex.push(null));

        tlsSocket = tls.connect({ socket: duplex, servername: parsed.hostname, rejectUnauthorized: false }, () => {
          if (clientDisconnected) return cleanup();
          let reqHeaders = `${req.method} ${parsed.pathname}${parsed.search} HTTP/1.1\r\n` +
            `Host: ${parsed.hostname}\r\n` +
            `User-Agent: ${USER_AGENT}\r\n` +
            `Referer: https://upskirt.tv/\r\n` +
            `Origin: https://upskirt.tv\r\n` +
            `Connection: close\r\n`;
          if (req.headers.range) {
            reqHeaders += `Range: ${req.headers.range}\r\n`;
          }
          reqHeaders += '\r\n';
          tlsSocket.write(reqHeaders);
        });

        let headerParsed = false;
        let leftover = Buffer.alloc(0);

        tlsSocket.on('data', chunk => {
          if (clientDisconnected) return cleanup();
          if (!headerParsed) {
            leftover = Buffer.concat([leftover, chunk]);
            const idx = leftover.indexOf('\r\n\r\n');
            if (idx !== -1) {
              headerParsed = true;
              const headerStr = leftover.slice(0, idx).toString('utf-8');
              const bodyChunk = leftover.slice(idx + 4);
              const firstLine = headerStr.split('\r\n')[0];
              const statusCode = parseInt(firstLine.split(' ')[1], 10) || 200;

              // Auto-Healing Shield: If token expired upstream (403), re-resolve fresh and resume!
              if (statusCode === 403 && !isRetry && numericId) {
                cleanup();
                return getOrResolveUtStream(numericId, true).then(fresh => {
                  const freshUpstream = (fresh && fresh.upstreamUrl && fresh.upstreamUrl.startsWith('http'))
                    ? fresh.upstreamUrl
                    : (fresh && fresh.streamUrl && fresh.streamUrl.startsWith('http') ? fresh.streamUrl : null);
                  if (freshUpstream) {
                    setUtTokenInVault(numericId, freshUpstream, fresh.expiresAt);
                    streamFromUpstream(freshUpstream, true);
                  } else {
                    if (!res.headersSent) res.status(403).send('Stream token expired');
                  }
                }).catch(() => {
                  if (!res.headersSent) res.status(403).send('Stream token expired');
                });
              }

              res.status(statusCode);
              res.setHeader('Access-Control-Allow-Origin', '*');
              res.setHeader('Access-Control-Allow-Headers', '*');
              res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
              res.setHeader('Accept-Ranges', 'bytes');

              headerStr.split('\r\n').slice(1).forEach(line => {
                const colon = line.indexOf(':');
                if (colon !== -1) {
                  const k = line.slice(0, colon).trim().toLowerCase();
                  const v = line.slice(colon + 1).trim();
                  if (['content-type', 'content-length', 'content-range', 'cache-control'].includes(k)) {
                    res.setHeader(k, v);
                  }
                }
              });

              if (bodyChunk.length > 0) {
                const ok = res.write(bodyChunk);
                if (!ok) {
                  tlsSocket.pause();
                  res.once('drain', () => tlsSocket.resume());
                }
              }
            }
          } else {
            // RAM Guard: Backpressure streaming ensures Node memory never exceeds ~64KB per stream!
            const ok = res.write(chunk);
            if (!ok) {
              tlsSocket.pause();
              res.once('drain', () => tlsSocket.resume());
            }
          }
        });

        tlsSocket.on('end', () => res.end());
        tlsSocket.on('error', () => { if (!res.headersSent) res.status(502).send('Error proxying video'); });
      });

      raw.on('error', () => { if (!res.headersSent) res.status(502).send('Stream connection failed'); });
      raw.setTimeout(12000, () => {
        cleanup();
        if (!res.headersSent) res.status(504).send('Stream gateway timeout');
      });
    } catch (e) {
      if (!res.headersSent) res.status(400).send('Invalid stream request');
    }
  };

  streamFromUpstream(targetUrl);
});

app.get('/api/ut/sync', (req, res) => {
  if (isUtSyncing()) {
    return res.json({ ok: false, message: 'Sync already in progress' });
  }
  const pages = parseInt(req.query.pages, 10) || 5;
  res.json({ ok: true, message: `Sync initiated in background for ${pages} pages` });
  syncUtCatalog(pages).catch(err => console.error('[Upskirt Sync API Error]:', err.message));
});

// ==========================================
// SEXKBJ (KOREAN BJ) ENDPOINTS
// ==========================================

// 1. Categories
app.get('/api/skbj/categories', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  res.json({ ok: true, categories: SKBJ_CATEGORIES });
});

// 2. Browse
app.get('/api/skbj/browse', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = getSkbjBrowse(page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 3. Category
app.get('/api/skbj/category/:slug', (req, res) => {
  const slug = req.params.slug;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = getSkbjCategory(slug, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 4. Search
app.get('/api/skbj/search', (req, res) => {
  const query = req.query.q || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = searchSkbjVideos(query, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 5. Stream Info
app.get('/api/skbj/stream-info', (req, res) => {
  const id = req.query.id;
  const video = id && getSkbjVideoById(id);
  if (video && (video.directStreamUrl || video.streamUrl)) {
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
    return res.json({
      ok: true,
      type: 'mp4',
      streamUrl: video.directStreamUrl || video.streamUrl,
      fallbackUrl: video.streamUrl,
      poster: video.poster,
      thumb: video.thumb,
      title: video.title
    });
  }
  res.status(404).json({ ok: false, error: 'Video not found in SexKbj catalog' });
});

// ==========================================
// UNIFIED CINEMA FULL-VIDEO APIS
// Combines KamaBaba, ViralMMS, SexKbj, Upskirt
// ==========================================

const handleCinemaFeed = (req, res) => {
  const isPost = req.method === 'POST';
  const body = req.body || {};
  const query = req.query || {};

  const source = (isPost ? body.source : query.source) || 'all';
  const page = parseInt(isPost ? body.page : query.page, 10) || 1;
  const limit = parseInt(isPost ? body.limit : query.limit, 10) || 20;

  if (source === 'viralmms') return res.json(getVmmsBrowse(page, limit));
  if (source === 'kamababa') return res.json(getKmbBrowse(page, limit));
  if (source === 'skbj') return res.json(getSkbjBrowse(page, limit));
  if (source === 'upskirt') return res.json(getUtBrowse(page, limit));
  if (source === 'pornbusy' || source === 'western') return res.json(getPbBrowse(page, limit));

  const topTags = isPost ? (body.topTags || {}) : {};
  const recentSeenIds = isPost ? (body.recentSeenIds || []) : (query.seenIds ? query.seenIds.split(',') : []);
  const recentTags = isPost ? (body.recentTags || []) : [];

  const result = cinemaRecommender.getPersonalizedHomeFeed({
    page,
    limit,
    topTags,
    recentSeenIds,
    recentTags
  });

  res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=300');
  res.json(result);
};

app.get('/api/cinema/feed', handleCinemaFeed);
app.post('/api/cinema/feed', handleCinemaFeed);

app.post('/api/cinema/telemetry', (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : (req.body ? [req.body] : []);
    const count = cinemaRecommender.recordCinemaTelemetry(events);
    res.json({ ok: true, processed: count });
  } catch (err) {
    console.error('[Cinema Telemetry Error]:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.get('/api/cinema/category/:slug', (req, res) => {
  const slug = req.params.slug;
  const source = req.query.source || 'all';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  if (source === 'pornbusy' || source === 'western') {
    return res.json(getPbCategory(slug, page, limit));
  }

  const kmbRes = getKmbCategory(slug, page, 15);
  const vmmsRes = getVmmsCategory(slug, page, 5);

  const kmb = (kmbRes.videos || []).map(v => ({ ...v, sourceName: 'KamaBaba', source: 'kamababa' }));
  const vmms = (vmmsRes.videos || []).map(v => ({ ...v, sourceName: 'ViralMMS', source: 'viralmms' }));

  const combined = [];
  let k = 0, v = 0;
  while (k < kmb.length || v < vmms.length) {
    if (k < kmb.length) combined.push(kmb[k++]);
    if (k < kmb.length) combined.push(kmb[k++]);
    if (k < kmb.length) combined.push(kmb[k++]);
    if (v < vmms.length) combined.push(vmms[v++]);
  }

  const total = (kmbRes.total || 0) + (vmmsRes.total || 0);

  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800');
  res.json({
    ok: true,
    category: slug,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 1,
    source: 'all',
    videos: combined
  });
});

app.get('/api/cinema/search', (req, res) => {
  const query = req.query.q || '';
  const source = req.query.source || 'all';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;

  if (source === 'viralmms') {
    return res.json(searchVmmsVideos(query, page, limit));
  } else if (source === 'kamababa') {
    return res.json(searchKmbVideos(query, page, limit));
  } else if (source === 'skbj') {
    return res.json(searchSkbjVideos(query, page, limit));
  } else if (source === 'upskirt') {
    return res.json(searchUtVideos(query, page, limit));
  } else if (source === 'pornbusy' || source === 'western') {
    return res.json(searchPbVideos(query, page, limit));
  }

  // Cross-provider unified search without artificial truncation
  const utRes = (typeof searchUtVideos === 'function') ? (searchUtVideos(query, 1, 99999).videos || []) : [];
  const kmbRes = (typeof searchKmbVideos === 'function') ? (searchKmbVideos(query, 1, 99999).videos || []) : [];
  const vmmsRes = (typeof searchVmmsVideos === 'function') ? (searchVmmsVideos(query, 1, 99999).videos || []) : [];
  const pbRes = (typeof searchPbVideos === 'function') ? (searchPbVideos(query, 1, 99999).videos || []) : [];
  const skbjRes = (typeof searchSkbjVideos === 'function') ? (searchSkbjVideos(query, 1, 99999).videos || []) : [];

  const merged = [
    ...utRes.map(v => ({ ...v, sourceName: 'UPSKIRT HD', source: 'upskirt' })),
    ...kmbRes.map(v => ({ ...v, sourceName: 'KamaBaba', source: 'kamababa' })),
    ...vmmsRes.map(v => ({ ...v, sourceName: 'ViralMMS', source: 'viralmms' })),
    ...pbRes.map(v => ({ ...v, sourceName: 'WESTERN HD', source: 'pornbusy' })),
    ...skbjRes.map(v => ({ ...v, sourceName: 'SexKbj', source: 'skbj' }))
  ];

  const total = merged.length;
  const totalPages = Math.ceil(total / limit) || 1;
  const start = (page - 1) * limit;
  const slice = merged.slice(start, start + limit);

  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800');
  res.json({
    ok: true,
    query,
    page,
    limit,
    total,
    totalPages,
    hasMore: (page * limit) < total,
    videos: slice
  });
});

// Dedicated PornBusy Western Endpoints
app.get('/api/pornbusy/categories', (req, res) => {
  res.json({ ok: true, categories: PB_CATEGORIES.map(c => ({ name: c.charAt(0).toUpperCase() + c.slice(1), slug: c })) });
});
app.get('/api/pornbusy/browse', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  res.json(getPbBrowse(page, limit));
});
app.get('/api/pornbusy/category/:slug', (req, res) => {
  const slug = req.params.slug;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  res.json(getPbCategory(slug, page, limit));
});
app.get('/api/pornbusy/search', (req, res) => {
  const query = req.query.q || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  res.json(searchPbVideos(query, page, limit));
});

app.get('/api/cinema/related', (req, res) => {
  const currentId = req.query.id || '';
  const limit = Math.min(24, Math.max(4, parseInt(req.query.limit, 10) || 12));
  const sessionSeenIds = req.query.seenIds ? req.query.seenIds.split(',') : [];

  let currentVideo = null;
  if (typeof getKmbVideoById === 'function') currentVideo = getKmbVideoById(currentId);
  if (!currentVideo && typeof getVmmsVideoById === 'function') currentVideo = getVmmsVideoById(currentId);
  if (!currentVideo && typeof getPbVideoById === 'function') currentVideo = getPbVideoById(currentId);
  if (!currentVideo && typeof getSkbjVideoById === 'function') currentVideo = getSkbjVideoById(currentId);

  if (!currentVideo) {
    currentVideo = {
      id: currentId,
      category: req.query.category || '',
      title: req.query.title || '',
      tags: [req.query.category].filter(Boolean)
    };
  }

  const results = cinemaRecommender.getRelatedVideos(currentVideo, {
    limit,
    sessionSeenIds
  });

  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=600');
  res.json({
    ok: true,
    currentId,
    count: results.length,
    videos: results
  });
});

// 7. Resilient In-Memory Thumbnail Proxy
// Bypasses Indian ISP DNS blocks and third-party image proxy bans
const thumbCache = new Map();



app.get('/api/thumb', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    return res.status(400).send('Missing url');
  }

  if (thumbCache.has(imageUrl)) {
    const cached = thumbCache.get(imageUrl);
    res.setHeader('Content-Type', cached.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.send(cached.data);
  }

  // Upskirt DPI Bypass Shield for pix.upskirt.tv (bypasses ISP middlebox ECONNRESET)
  if (imageUrl.includes('pix.upskirt.tv') || imageUrl.includes('upskirt.tv')) {
    try {
      const result = await fetchPixDpi(imageUrl);
      if (result && result.data && result.data.length > 200) {
        if (thumbCache.size > 1000) {
          const firstKey = thumbCache.keys().next().value;
          thumbCache.delete(firstKey);
        }
        thumbCache.set(imageUrl, result);
        res.setHeader('Content-Type', result.contentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        return res.send(result.data);
      }
    } catch (err) {
      console.warn('[Pix DPI Error]:', err.message);
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="100%" height="100%" fill="#18181b"/><text x="50%" y="50%" fill="#71717a" font-family="sans-serif" font-size="14" text-anchor="middle" dominant-baseline="middle">Upskirt Preview</text></svg>');
    }
  }

  try {
    const parsed = new URL(imageUrl);
    const transport = parsed.protocol === 'https:' ? https : http;

    let responded = false;
    const safeRedirect = () => {
      if (!responded) {
        responded = true;
        try { res.redirect(imageUrl); } catch (_) {}
      }
    };

    const request = transport.get(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
      },
      timeout: 7000
    }, (upstreamRes) => {
      if (upstreamRes.statusCode !== 200) {
        return safeRedirect();
      }

      const chunks = [];
      upstreamRes.on('data', chunk => chunks.push(chunk));
      upstreamRes.on('end', () => {
        if (responded) return;
        responded = true;
        const buffer = Buffer.concat(chunks);
        const contentType = upstreamRes.headers['content-type'] || 'image/jpeg';

        if (thumbCache.size > 500) {
          const firstKey = thumbCache.keys().next().value;
          thumbCache.delete(firstKey);
        }
        thumbCache.set(imageUrl, { data: buffer, contentType });

        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        res.send(buffer);
      });
    });

    request.on('timeout', () => {
      request.destroy();
      safeRedirect();
    });

    request.on('error', () => {
      safeRedirect();
    });
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).send('Error loading thumbnail');
    }
  }
});

const livePlaylistCache = new Map();

function setLivePlaylistCache(key, data, ttlMs = 3600000) {
  if (livePlaylistCache.size > 2000) {
    const oldestKey = livePlaylistCache.keys().next().value;
    livePlaylistCache.delete(oldestKey);
  }
  livePlaylistCache.set(key, { data, expiresAt: Date.now() + ttlMs });
}

// Desi52 / Plauymito HLS proxy removed to protect VPS bandwidth
app.get('/api/live.m3u8', (req, res) => res.status(404).send('Desi52 HLS proxy disabled to preserve VPS bandwidth'));
app.get('/api/chunk', (req, res) => res.status(404).send('HLS chunk proxy disabled to preserve VPS bandwidth'));

app.get('/api/key', (req, res) => {
  const keyUrl = req.query.url;
  if (!keyUrl) return res.status(400).send('Missing url');

  try {
    const parsed = new URL(keyUrl);
    const isLulu = parsed.hostname.includes('tnmr.org') || parsed.hostname.includes('lulu');
    const customRef = req.query.ref;
    const referer = customRef || (isLulu ? 'https://luluvido.com/' : 'https://playmate.to/');
    const origin = referer.replace(/\/$/, '');

    const keyClient = parsed.protocol === 'http:' ? http : https;
    keyClient.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.pathname + parsed.search,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Chromium";v="120", "Not(A:Brand";v="24", "Google Chrome";v="120"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'cross-site',
        'Referer': referer,
        'Origin': origin
      }
    }, upstreamRes => {
      res.status(upstreamRes.statusCode || 200);
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      upstreamRes.pipe(res);
    }).on('error', err => {
      console.error('[Key Proxy Error]:', err.message);
      if (!res.headersSent) res.status(502).send('Error proxying key');
    });
  } catch (err) {
    if (!res.headersSent) res.status(400).send('Invalid key URL');
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
    // Disabled expiring token refreshers per architectural mandate (Permanent CDNs only)
    // startUpAutoRefresher();
    // startClAutoRefresher();
  });
}
