const express = require('express');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const { Transform, Duplex } = require('stream');

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
  syncCatalog: syncVmmsCatalog,
  isSyncing: isVmmsSyncing,
  getCatalogSize: getVmmsCatalogSize
} = require('./viralmms_catalog');
const {
  CATEGORIES: UP_CATEGORIES,
  getBrowseVideos: getUpBrowse,
  getCategoryVideos: getUpCategory,
  searchVideos: searchUpVideos,
  getVideoById: getUpVideoById,
  getOrResolveStream: getOrResolveUpStream,
  syncCatalog: syncUpCatalog,
  startAutoRefresher: startUpAutoRefresher,
  isSyncing: isUpSyncing,
  getCatalogSize: getUpCatalogSize
} = require('./usersporn_catalog');
const {
  CATEGORIES: CL_CATEGORIES,
  getBrowseVideos: getClBrowse,
  getCategoryVideos: getClCategory,
  searchVideos: searchClVideos,
  getVideoById: getClVideoById,
  getOrResolveStream: getOrResolveClStream,
  syncCatalog: syncClCatalog,
  startAutoRefresher: startClAutoRefresher,
  isSyncing: isClSyncing,
  getCatalogSize: getClCatalogSize
} = require('./cumlouder_catalog');
const {
  CATEGORIES: UT_CATEGORIES,
  getUtBrowse,
  searchUtVideos,
  getOrResolveUtStream,
  syncCatalog: syncUtCatalog,
  isSyncing: isUtSyncing
} = require('./upskirt_catalog');

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

// 2. Browse Videos (Serves 100% pre-verified, zero-broken, fast Playmate videos instantly)
app.get('/api/browse', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const verified = getVerifiedBrowse(page, 20);
  if (verified && verified.totalVideos > 0) {
    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=3600, stale-while-revalidate=86400');
    return res.json(verified);
  }

  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json({ ok: true, videos: [], page, totalPages: 0, hasNextPage: false, hasPrevPage: false });
});

// 3. Category Videos (Instant response from pre-verified fast catalog)
app.get('/api/category/:slug', async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const slug = req.params.slug;

  const verified = getVerifiedCategory(slug, page, 20);
  if (verified && verified.totalVideos > 0) {
    res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=3600, stale-while-revalidate=86400');
    return res.json(verified);
  }

  // Fallback: search verified catalog by slug keywords for 100% working results
  const catalog = getLocalCatalog();
  const matched = catalog.filter(v => 
    (v.category && v.category.includes(slug)) || 
    (v.title && v.title.toLowerCase().includes(slug.replace(/-/g, ' '))) ||
    (v.url && v.url.toLowerCase().includes(slug.replace(/-/g, ' ')))
  );
  const limit = 20;
  const start = (page - 1) * limit;
  const slice = matched.slice(start, start + limit);
  const totalPages = Math.ceil(matched.length / limit) || 1;

  res.setHeader('Cache-Control', 'public, max-age=120, s-maxage=3600, stale-while-revalidate=86400');
  res.json({
    ok: true,
    category: slug,
    page: Number(page),
    totalPages,
    totalVideos: matched.length,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    videos: slice.map((v, idx) => ({ ...v, title: v.title || `Video ${start + idx + 1}` }))
  });
});

// 4. Search Videos (Instant search across 100% verified fast catalog)
app.get('/api/search', async (req, res) => {
  const query = (req.query.q || '').trim().toLowerCase();
  const page = parseInt(req.query.page, 10) || 1;
  if (!query) {
    return res.status(400).json({ ok: false, error: 'Empty search query' });
  }

  const catalog = getLocalCatalog();
  const terms = query.split(/\s+/);
  const matched = catalog.filter(v => {
    const text = `${v.title || ''} ${v.url || ''} ${v.category || ''}`.toLowerCase();
    return terms.every(t => text.includes(t));
  });

  const limit = 20;
  const start = (page - 1) * limit;
  const slice = matched.slice(start, start + limit);
  const totalPages = Math.ceil(matched.length / limit) || 1;
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json({
    ok: true,
    query,
    page: Number(page),
    totalPages,
    totalVideos: matched.length,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    videos: slice
  });
});

// 5. Get Direct Stream URL (Instant response from pre-verified catalog)
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
// USERSPORN DIRECT MP4 ZERO-BANDWIDTH APIS
// Fast, microsecond RAM responses, 0 VPS bandwidth
// Multi-Quality Single-Token (360p - 1080p)
// ==========================================

// 1. UsersPorn Categories
app.get('/api/up/categories', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  res.json({ ok: true, categories: UP_CATEGORIES });
});

// 2. UsersPorn Browse (Instant RAM response with direct streamUrl & qualityUrls)
app.get('/api/up/browse', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = getUpBrowse(page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 3. UsersPorn Category
app.get('/api/up/category/:slug', (req, res) => {
  const slug = req.params.slug;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = getUpCategory(slug, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 4. UsersPorn Search
app.get('/api/up/search', (req, res) => {
  const query = req.query.q || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = searchUpVideos(query, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 5. UsersPorn Stream Info (0ms fast path for hot items, on-demand lazy resolution for cold items)
app.get('/api/up/stream-info', async (req, res) => {
  const id = req.query.id || req.query.rawId;
  const force = req.query.force === '1' || req.query.force === 'true';
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });

  try {
    const video = await getOrResolveUpStream(id, force);
    if (video && video.streamUrl) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      return res.json({
        ok: true,
        type: 'mp4',
        id: video.id,
        rawId: video.rawId,
        streamUrl: video.streamUrl,
        rawUrl: video.streamUrl,
        qualityUrls: video.qualityUrls,
        qualities: video.qualities,
        defaultQuality: video.defaultQuality,
        expiresAt: video.expiresAt,
        poster: video.poster,
        thumb: video.thumb,
        title: video.title
      });
    }
    res.status(404).json({ ok: false, error: 'Video stream could not be resolved' });
  } catch (err) {
    console.error('[UsersPorn Stream Info Error]:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. UsersPorn Background Sync Trigger
app.get('/api/up/sync', (req, res) => {
  if (isUpSyncing()) {
    return res.json({ ok: false, message: 'Sync already in progress' });
  }
  const pages = parseInt(req.query.pages, 10) || 3;
  res.json({ ok: true, message: `Sync initiated in background for ${pages} pages` });
  syncUpCatalog(pages).catch(err => console.error('[UsersPorn Sync API Error]:', err.message));
});

// ==========================================
// CUMLOUDER HYBRID DUAL-ENGINE ZERO-BANDWIDTH APIS
// Native MP4 (0ms) + Embed Fallback (0ms), 0 VPS Bandwidth
// ==========================================

// 1. Cumlouder Categories
app.get('/api/cl/categories', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
  res.json({ ok: true, categories: CL_CATEGORIES });
});

// 2. Cumlouder Browse (Instant RAM response with streamUrl/embedUrl)
app.get('/api/cl/browse', (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = getClBrowse(page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 3. Cumlouder Category
app.get('/api/cl/category/:slug', (req, res) => {
  const slug = req.params.slug;
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = getClCategory(slug, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 4. Cumlouder Search
app.get('/api/cl/search', (req, res) => {
  const query = req.query.q || '';
  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 20;
  const result = searchClVideos(query, page, limit);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=1800, stale-while-revalidate=86400');
  res.json(result);
});

// 5. Cumlouder Stream Info (Fast path for hot items, lazy on-demand resolver for cold items)
app.get('/api/cl/stream-info', async (req, res) => {
  const id = req.query.id || req.query.slug;
  const force = req.query.force === '1' || req.query.force === 'true';
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id or slug' });

  try {
    const video = await getOrResolveClStream(id, force);
    if (video && (video.streamUrl || video.embedUrl)) {
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
      return res.json({
        ok: true,
        type: 'mp4',
        id: video.id,
        slug: video.slug,
        numericId: video.numericId,
        streamUrl: video.streamUrl || '',
        embedUrl: video.embedUrl || (video.numericId ? `https://www.cumlouder.com/embed/${video.numericId}/` : ''),
        poster: video.poster || video.thumb,
        thumb: video.thumb,
        title: video.title
      });
    }
    res.status(404).json({ ok: false, error: 'Video stream could not be resolved' });
  } catch (err) {
    console.error('[Cumlouder Stream Info Error]:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 6. Cumlouder Background Sync Trigger
app.get('/api/cl/sync', (req, res) => {
  if (isClSyncing()) {
    return res.json({ ok: false, message: 'Sync already in progress' });
  }
  const pages = parseInt(req.query.pages, 10) || 5;
  res.json({ ok: true, message: `Sync initiated in background for ${pages} pages` });
  syncClCatalog(pages).catch(err => console.error('[Cumlouder Sync API Error]:', err.message));
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

// 4. Upskirt Stream Info (Fast path from RAM + Instant API resolution via POST api.upskirt.tv/hls)
app.get('/api/ut/stream-info', async (req, res) => {
  const id = req.query.id || req.query.numericId;
  const force = req.query.force === '1' || req.query.force === 'true';
  if (!id) return res.status(400).json({ ok: false, error: 'Missing id or numericId' });

  try {
    const video = await getOrResolveUtStream(id, force);
    if (video && video.streamUrl) {
      res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
      return res.json({
        ok: true,
        type: 'mp4',
        id: video.id,
        numericId: video.numericId,
        slug: video.slug,
        streamUrl: video.streamUrl,
        mp4_1080: video.mp4_1080 || '',
        mp4_480: video.mp4_480 || '',
        master: video.master || '',
        mp4List: video.mp4List || [],
        thumb: video.thumb || '',
        preview: video.preview || '',
        duration: video.duration || '',
        title: video.title || ''
      });
    }
    res.status(404).json({ ok: false, error: 'Video stream could not be resolved' });
  } catch (err) {
    console.error('[Upskirt Stream Info Error]:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 5. Upskirt Background Sync Trigger
app.get('/api/ut/sync', (req, res) => {
  if (isUtSyncing()) {
    return res.json({ ok: false, message: 'Sync already in progress' });
  }
  const pages = parseInt(req.query.pages, 10) || 5;
  res.json({ ok: true, message: `Sync initiated in background for ${pages} pages` });
  syncUtCatalog(pages).catch(err => console.error('[Upskirt Sync API Error]:', err.message));
});

// 7. Resilient In-Memory Thumbnail Proxy
// Bypasses Indian ISP DNS blocks and third-party image proxy bans
const thumbCache = new Map();



class DpiSplitterThumb extends Transform {
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

function fetchCumlouderThumbDpi(hostname, pathname) {
  return new Promise((resolve, reject) => {
    const raw = net.connect(443, '79.127.138.15', () => {
      const splitter = new DpiSplitterThumb();
      splitter.pipe(raw);
      const duplex = new Duplex({ read() {}, write(c, e, cb) { splitter.write(c, e, cb); } });
      raw.on('data', c => duplex.push(c));
      const t = tls.connect({ socket: duplex, servername: hostname, rejectUnauthorized: false }, () => {
        t.write(`GET ${pathname} HTTP/1.1\r\nHost: ${hostname}\r\nUser-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\nConnection: close\r\n\r\n`);
      });
      const chunks = [];
      t.on('data', c => chunks.push(c));
      t.on('end', () => {
        const buf = Buffer.concat(chunks);
        const idx = buf.indexOf('\r\n\r\n');
        resolve(idx !== -1 ? buf.slice(idx + 4) : buf);
      });
      t.on('error', reject);
    });
    raw.setTimeout(6000, () => { raw.destroy(); reject(new Error('timeout')); });
    raw.on('error', reject);
  });
}

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

  // Cumlouder CDN77 DPI Bypass Shield (supports th0cdn.cumlouder.com and im0.imgcm.com)
  if (imageUrl.includes('cumlouder.com') || imageUrl.includes('th0cdn') || imageUrl.includes('imgcm.com')) {
    try {
      const parsed = new URL(imageUrl);
      const buffer = await fetchCumlouderThumbDpi(parsed.hostname, parsed.pathname);
      if (buffer && buffer.length > 500) {
        if (thumbCache.size > 1000) {
          const firstKey = thumbCache.keys().next().value;
          thumbCache.delete(firstKey);
        }
        thumbCache.set(imageUrl, { data: buffer, contentType: 'image/jpeg' });
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        return res.send(buffer);
      }
    } catch (e) {
      // Fall through to standard proxy
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

  const fetchText = async (targetUrl) => {
    try {
      const parsed = new URL(targetUrl);
      const isLulu = parsed.hostname.includes('tnmr.org') || parsed.hostname.includes('lulu');
      const customRef = req.query.ref;
      const referer = customRef || (isLulu ? 'https://luluvido.com/' : 'https://playmate.to/');
      const origin = referer.replace(/\/$/, '');

      return await httpGet(targetUrl, {
        'Referer': referer,
        'Origin': origin,
        'Accept': '*/*'
      }, 7000);
    } catch (e) {
      console.error('[fetchText error]:', e.message);
      return '';
    }
  };

  try {
    const masterData = await fetchText(masterUrl);
    if (!masterData || !masterData.includes('#EXTM3U')) {
      console.error('[live.m3u8] masterData invalid or empty, len:', (masterData || '').length);
      return res.status(502).send('Invalid playlist from upstream host');
    }
    
    // Check if master playlist points to a subplaylist (e.g. index_avc_1280p.txt)
    // Only search for subplaylists if the playlist does NOT already contain media segments
    let finalPlaylist = masterData;
    let basePlaylistUrl = masterUrl;

    if (!masterData.includes('#EXTINF')) {
      const lines = masterData.split('\n');
      const subLine = lines.find(line => {
        const trimmed = line.trim();
        return trimmed && !trimmed.startsWith('#') && (trimmed.includes('.m3u8') || trimmed.includes('.txt'));
      });

      if (subLine) {
        const subUrl = new URL(subLine.trim(), masterUrl).toString();
        const subData = await fetchText(subUrl);
        if (subData.includes('#EXTINF')) {
          finalPlaylist = subData;
          basePlaylistUrl = subUrl;
        }
      }
    }

    const isLuluStream = basePlaylistUrl.includes('tnmr.org') || basePlaylistUrl.includes('lulu');
    const customRef = req.query.ref;
    const streamReferer = customRef || (isLuluStream ? 'https://luluvido.com/' : 'https://playmate.to/');

    // Rewrite all segment lines and AES keys:
    // For AES-128: route key through /api/key so it is fetched with matching UA & Referer
    // For Lulu or iOS: route TS segments through /api/chunk to inject matching UA / Referer / video/mp2t MIME
    // For Playmate on PC/Android: direct CDN URLs for zero server bandwidth
    const rewritten = finalPlaylist.split('\n').map(line => {
      const trimmed = line.trim();
      if (!trimmed) return line;

      // Handle AES-128 key URI
      if (trimmed.startsWith('#EXT-X-KEY')) {
        return trimmed.replace(/URI=["']([^"']+)["']/, (match, uri) => {
          const fullKeyUrl = new URL(uri, basePlaylistUrl).toString();
          return `URI="/api/key?url=${encodeURIComponent(fullKeyUrl)}&ref=${encodeURIComponent(streamReferer)}"`;
        });
      }

      if (!trimmed.startsWith('#')) {
        const fullSegUrl = new URL(trimmed, basePlaylistUrl).toString();
        // Playmate & non-Lulu streams have full CORS: * support.
        // On non-iOS devices, stream directly from CDN for 0 VPS bandwidth & 0 latency!
        if (!isLuluStream && !isIOS) {
          return fullSegUrl;
        }
        return `/api/chunk?url=${encodeURIComponent(fullSegUrl)}&ref=${encodeURIComponent(streamReferer)}`;
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

// HLS Segment Proxy for Apple iOS Safari & LuluStream (Fixes fake MIME & UA binding)
app.get('/api/chunk', (req, res) => {
  const chunkUrl = req.query.url;
  if (!chunkUrl) return res.status(400).send('Missing url');

  try {
    const parsed = new URL(chunkUrl);
    const isLulu = parsed.hostname.includes('tnmr.org') || parsed.hostname.includes('lulu');
    const customRef = req.query.ref;
    const referer = customRef || (isLulu ? 'https://luluvido.com/' : 'https://playmate.to/');
    const origin = referer.replace(/\/$/, '');

    const headers = {
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
    };
    if (req.headers.range) {
      headers['Range'] = req.headers.range;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const agent = parsed.protocol === 'http:' ? proxyAgentHttp : proxyAgentHttps;
    client.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
      path: parsed.pathname + parsed.search,
      headers,
      agent
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

// AES-128 Decryption Key Proxy (Ensures matching UA & Referer for HLS decryptor)
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
    startUpAutoRefresher();
    startClAutoRefresher();
  });
}
