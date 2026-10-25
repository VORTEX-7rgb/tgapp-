const fs = require('fs');
const path = require('path');

const PRIMARY_CATALOG = path.join(__dirname, 'data', 'pornbusy_catalog.json');
const FALLBACK_CATALOG = path.join(__dirname, 'pornbusy_catalog.json');

const catalogMap = new Map();
let catalogList = [];

const CATEGORIES = [
  'western',
  'blonde',
  'brunette',
  'pov',
  'taboo',
  'creampie',
  'teen',
  'redhead',
  'amateur',
  'glamour',
  'milf',
  'fitness'
];

/**
 * Loads the saved catalog from disk into RAM
 */
function loadCatalog() {
  try {
    const fileToLoad = fs.existsSync(PRIMARY_CATALOG) ? PRIMARY_CATALOG : (fs.existsSync(FALLBACK_CATALOG) ? FALLBACK_CATALOG : null);
    if (fileToLoad) {
      const raw = fs.readFileSync(fileToLoad, 'utf8');
      const items = JSON.parse(raw);
      if (Array.isArray(items)) {
        catalogMap.clear();
        items.forEach(item => {
          if (item && item.id && item.streamUrl) {
            catalogMap.set(item.id, item);
          }
        });
        catalogList = Array.from(catalogMap.values());
        console.log(`[PornBusy Catalog] Loaded ${catalogMap.size} verified Western HD videos into memory.`);
      }
    } else {
      console.warn('[PornBusy Catalog] No catalog file found on disk.');
    }
  } catch (err) {
    console.error('[PornBusy Catalog] Error loading catalog from disk:', err.message);
  }
}

/**
 * Returns a paginated list of videos
 */
function getBrowseVideos(page = 1, limit = 20) {
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
    source: 'pornbusy',
    videos
  };
}

/**
 * Returns videos filtered by category
 */
function getCategoryVideos(category, page = 1, limit = 20) {
  if (!category || category === 'all' || category === 'western') {
    return getBrowseVideos(page, limit);
  }

  const catLower = category.toLowerCase().trim();
  const matched = catalogList.filter(v => {
    return (v.category && v.category.toLowerCase() === catLower) ||
           (Array.isArray(v.tags) && v.tags.some(t => t.toLowerCase() === catLower));
  });

  const total = matched.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.max(1, Math.min(page, totalPages));
  const start = (safePage - 1) * limit;
  const end = start + limit;
  const videos = matched.slice(start, end);

  return {
    ok: true,
    category,
    page: safePage,
    limit,
    total,
    totalPages,
    source: 'pornbusy',
    videos
  };
}

/**
 * Searches the in-memory catalog
 */
function searchVideos(query, page = 1, limit = 20) {
  const q = (query || '').toLowerCase().trim();
  if (!q) {
    return getBrowseVideos(page, limit);
  }

  const terms = q.split(/\s+/).filter(Boolean);
  const matched = catalogList.filter(v => {
    const text = `${v.title || ''} ${v.slug || ''} ${v.category || ''} ${(v.tags || []).join(' ')}`.toLowerCase();
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
    source: 'pornbusy',
    videos
  };
}

function getVideoById(id) {
  return catalogMap.get(id) || null;
}

function getCatalogSize() {
  return catalogMap.size;
}

// Initial load
loadCatalog();

if (fs.existsSync(PRIMARY_CATALOG)) {
  fs.watchFile(PRIMARY_CATALOG, { interval: 3000 }, (curr, prev) => {
    if (curr.mtimeMs !== prev.mtimeMs) {
      console.log('[Hot-Reload] Detected update in pornbusy_catalog.json, refreshing RAM catalog...');
      loadCatalog();
    }
  });
}

module.exports = {
  CATEGORIES,
  loadCatalog,
  getBrowseVideos,
  getCategoryVideos,
  searchVideos,
  getVideoById,
  getCatalogSize
};

