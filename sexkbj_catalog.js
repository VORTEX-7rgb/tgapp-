const fs = require('fs');
const path = require('path');

const CATALOG_FILE = path.join(__dirname, 'data', 'sexkbj_catalog.json');

const CATEGORIES = [
  { name: '🔥 All BJ Streams', slug: 'all' },
  { name: '🤳 Solo & Tease', slug: 'solo' },
  { name: '💃 Cam Dance & VIP', slug: 'dance' },
  { name: '👙 Bikini & Cosplay', slug: 'cosplay' },
  { name: '🍑 Strip & Nude', slug: 'strip' },
  { name: '⭐ Top BJ Models', slug: 'models' }
];

// In-Memory Index (O(1) Map lookups for 0.1ms response)
const catalogMap = new Map();
const categoryIndexMap = new Map();
let catalogList = [];
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
        categoryIndexMap.clear();

        items.forEach(item => {
          if (item && item.id && item.streamUrl) {
            catalogMap.set(item.id, item);

            // Populate Inverted Category Index
            const itemTags = Array.isArray(item.tags) ? item.tags : [];
            const allSlugs = new Set([item.category, ...itemTags]);
            for (const s of allSlugs) {
              if (!s) continue;
              if (!categoryIndexMap.has(s)) {
                categoryIndexMap.set(s, []);
              }
              categoryIndexMap.get(s).push(item);
            }
          }
        });
        catalogList = Array.from(catalogMap.values());
        console.log(`[SexKbj Catalog] Loaded ${catalogMap.size} verified videos across ${categoryIndexMap.size} categories into memory.`);
      }
    }
  } catch (err) {
    console.error('[SexKbj Catalog] Error loading catalog from disk:', err.message);
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
    source: 'skbj',
    videos
  };
}

/**
 * Paginated Category: Filters by category with direct streamUrl attached
 */
function getCategoryVideos(slug, page = 1, limit = 20) {
  checkAutoReload();
  let filtered;
  if (!slug || slug === 'all') {
    filtered = catalogList;
  } else if (categoryIndexMap.has(slug)) {
    filtered = categoryIndexMap.get(slug);
  } else {
    filtered = catalogList.filter(v =>
      v.category === slug ||
      (v.slug && v.slug.includes(slug)) ||
      (Array.isArray(v.tags) && v.tags.includes(slug))
    );
  }

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
    source: 'skbj',
    videos
  };
}

/**
 * In-memory keyword search across titles, slugs, categories, tags, and hashtags
 */
function searchVideos(query, page = 1, limit = 20) {
  checkAutoReload();
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    return getBrowseVideos(page, limit);
  }

  const terms = q.split(/\s+/).filter(Boolean);
  const matched = catalogList.filter(v => {
    const tagsStr = Array.isArray(v.tags) ? v.tags.join(' ') : '';
    const hashStr = Array.isArray(v.hashtags) ? v.hashtags.join(' ') : '';
    const text = `${v.title || ''} ${v.slug || ''} ${v.category || ''} ${tagsStr} ${hashStr}`.toLowerCase();
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
    source: 'skbj',
    videos
  };
}

function getCatalogSize() {
  checkAutoReload();
  return catalogList.length;
}

/**
 * Smart recommendation engine for SexKbj videos
 * Matches category, model tags, and title keywords, backfilling if needed
 */
function getRelatedVideos(currentId, category = '', title = '', limit = 12) {
  checkAutoReload();
  if (!catalogList || catalogList.length === 0) return [];

  const candidates = catalogList.filter(v => v.id !== currentId);
  if (candidates.length <= limit) return candidates;

  const targetCategory = (category || '').toLowerCase();
  const titleWords = (title || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !['korean', 'bj', 'dance', 'vip', 'cam', 'video', 'full', 'hd'].includes(w));

  const scored = candidates.map(v => {
    let score = 0;
    if (targetCategory && (v.category === targetCategory || (Array.isArray(v.tags) && v.tags.includes(targetCategory)))) {
      score += 15;
    }
    const vTitle = (v.title || '').toLowerCase();
    for (const w of titleWords) {
      if (vTitle.includes(w)) {
        score += 8;
      }
    }
    score += Math.random() * 2;
    return { video: v, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.video);
}

// Initial boot load
loadCatalog();

// Auto-reload on disk modification
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
  getVideoById,
  getVideoByUrl,
  getBrowseVideos,
  getCategoryVideos,
  searchVideos,
  getRelatedVideos,
  getCatalogSize
};
