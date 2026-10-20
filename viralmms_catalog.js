const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CATALOG_FILE = path.join(__dirname, 'data', 'viralmms_catalog.json');

const CATEGORIES = [
  { name: '🔥 All / Latest', slug: 'all' },
  { name: '🔞 Leaked Tapes', slug: 'xxx_leaked_tapes' },
  { name: '⚡ Viral Kand', slug: 'viral_porn_kand' },
  { name: '📱 Indian MMS', slug: 'indian_mms_porn' },
  { name: '💃 Desi Models', slug: 'indian_actress_nude_hub' },
  { name: '🌟 DesiHub', slug: 'desihub_premium' },
  { name: '🌾 Desi Punjab', slug: 'desi_punjab_porn' },
  { name: '🇵🇰 Pakistani MMS', slug: 'pakistani_porn' }
];

// In-Memory Index (O(1) Map lookups for sub-millisecond response)
const catalogMap = new Map();
let catalogList = [];
let isSyncing = false;
let lastLoadedMtime = 0;

/**
 * Loads the saved catalog from disk into RAM
 */
function loadCatalog() {
  try {
    if (fs.existsSync(CATALOG_FILE)) {
      lastLoadedMtime = fs.statSync(CATALOG_FILE).mtimeMs;
      const raw = fs.readFileSync(CATALOG_FILE, 'utf8');
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        catalogMap.clear();
        items.forEach(item => {
          if (item && item.id && item.streamUrl) {
            catalogMap.set(item.id, item);
          }
        });
        catalogList = Array.from(catalogMap.values());
        console.log(`[ViralMMS Catalog] Loaded ${catalogMap.size} verified videos into memory.`);
      }
    }
  } catch (err) {
    console.error('[ViralMMS Catalog] Error loading catalog from disk:', err.message);
  }
}

function checkAutoReload() {
  try {
    if (fs.existsSync(CATALOG_FILE)) {
      const mtime = fs.statSync(CATALOG_FILE).mtimeMs;
      if (mtime > lastLoadedMtime) {
        loadCatalog();
      }
    }
  } catch (err) {}
}

/**
 * Persists the in-memory catalog atomically to disk
 */
function saveCatalog() {
  try {
    const dir = path.dirname(CATALOG_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tempFile = `${CATALOG_FILE}.tmp`;
    const data = JSON.stringify(Array.from(catalogMap.values()), null, 2);
    fs.writeFileSync(tempFile, data, 'utf8');
    fs.renameSync(tempFile, CATALOG_FILE);
  } catch (err) {
    console.error('[ViralMMS Catalog] Error saving catalog to disk:', err.message);
  }
}

/**
 * Ingests a single video into the in-memory catalog
 */
function upsertVideo(video) {
  if (!video || !video.id || !video.streamUrl) return false;
  catalogMap.set(video.id, video);
  catalogList = Array.from(catalogMap.values());
  return true;
}

/**
 * Fast-path O(1) lookup by ID
 */
function getVideoById(id) {
  checkAutoReload();
  return catalogMap.get(id) || null;
}

/**
 * Fast-path lookup by post URL
 */
function getVideoByUrl(url) {
  checkAutoReload();
  if (!url) return null;
  return catalogList.find(v => v.postUrl === url || v.streamUrl === url) || null;
}

/**
 * Paginated Browse: Returns videos with direct streamUrl attached
 */
function getBrowseVideos(page = 1, limit = 20) {
  checkAutoReload();
  const total = catalogList.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * limit;
  const end = start + limit;
  const videos = catalogList.slice(start, end);

  return {
    ok: true,
    page: safePage,
    limit,
    total,
    totalPages,
    source: 'viralmms',
    videos
  };
}

/**
 * Paginated Category: Filters by category with direct streamUrl attached
 */
function getCategoryVideos(slug, page = 1, limit = 20) {
  checkAutoReload();
  const filtered = slug === 'all'
    ? catalogList
    : catalogList.filter(v => v.category === slug || (v.slug && v.slug.includes(slug)));

  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * limit;
  const end = start + limit;
  const videos = filtered.slice(start, end);

  return {
    ok: true,
    category: slug,
    page: safePage,
    limit,
    total,
    totalPages,
    source: 'viralmms',
    videos
  };
}

/**
 * In-memory keyword search across titles, slugs, and categories
 */
function searchVideos(query, page = 1, limit = 20) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    return getBrowseVideos(page, limit);
  }

  const terms = q.split(/\s+/).filter(Boolean);
  const matched = catalogList.filter(v => {
    const text = `${v.title || ''} ${v.slug || ''} ${v.category || ''}`.toLowerCase();
    return terms.every(t => text.includes(t));
  });

  const total = matched.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * limit;
  const end = start + limit;
  const videos = matched.slice(start, end);

  return {
    ok: true,
    query: q,
    page: safePage,
    limit,
    total,
    totalPages,
    source: 'viralmms',
    videos
  };
}

/**
 * Runs the scraper script in background to ingest fresh posts
 */
function syncCatalog() {
  if (isSyncing) return Promise.resolve(false);
  isSyncing = true;
  console.log('[ViralMMS Catalog] Starting background sync...');

  return new Promise((resolve) => {
    const py = spawn('python', ['-u', 'scrape_all_vmms.py'], { cwd: __dirname });
    py.stdout.on('data', (d) => {
      console.log(`[ViralMMS Sync] ${d.toString().trim()}`);
    });
    py.stderr.on('data', (d) => {
      console.error(`[ViralMMS Sync Error] ${d.toString().trim()}`);
    });
    py.on('close', (code) => {
      isSyncing = false;
      loadCatalog();
      console.log(`[ViralMMS Catalog] Sync completed with exit code ${code}. Total videos: ${catalogList.length}`);
      resolve(true);
    });
  });
}

function getCatalogSize() {
  checkAutoReload();
  return catalogList.length;
}

// Initial boot load
loadCatalog();

// Auto-reload into RAM when background scraper updates the JSON on disk
if (fs.existsSync(CATALOG_FILE)) {
  fs.watchFile(CATALOG_FILE, { interval: 2000 }, (curr, prev) => {
    if (curr.mtime !== prev.mtime) {
      loadCatalog();
    }
  });
}

module.exports = {
  CATEGORIES,
  loadCatalog,
  saveCatalog,
  upsertVideo,
  getVideoById,
  getVideoByUrl,
  getBrowseVideos,
  getCategoryVideos,
  searchVideos,
  syncCatalog,
  isSyncing: () => isSyncing,
  getCatalogSize
};
