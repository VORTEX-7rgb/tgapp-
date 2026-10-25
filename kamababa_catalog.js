const fs = require('fs');
const path = require('path');
const { getPostsFromListingPage, extractVideoFromPost, proxyThumbnail, CATEGORIES } = require('./kamababa_scraper');

const CATALOG_FILE = path.join(__dirname, 'data', 'kamababa_catalog.json');

// In-Memory Index (O(1) Map lookups for sub-millisecond response)
const catalogMap = new Map();
let catalogList = [];

// Mandatory Production Fix #5: Mutex lock to prevent overlapping sync operations
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
            // Guarantee clean ISP-proof thumbnail format (strip blocked wsrv.nl)
            if (!item.thumb || item.thumb.includes('wsrv.nl')) {
              item.thumb = item.poster ? proxyThumbnail(item.poster) : '';
            }
            catalogMap.set(item.id, item);
          }
        });
        catalogList = Array.from(catalogMap.values());
        console.log(`[KamaBaba Catalog] Loaded ${catalogMap.size} verified videos into memory.`);
      }
    }
  } catch (err) {
    console.error('[KamaBaba Catalog] Error loading catalog from disk:', err.message);
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
    console.error('[KamaBaba Catalog] Error saving catalog to disk:', err.message);
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
 * Paginated Browse: Returns videos with direct streamUrl attached (Mandatory Fix #3)
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
    source: 'mykamababa',
    videos
  };
}

/**
 * Paginated Category: Filters by category with direct streamUrl attached (Mandatory Fix #3)
 */
function getCategoryVideos(slug, page = 1, limit = 20) {
  checkAutoReload();
  const s = (slug || '').toLowerCase().trim();
  const filtered = (s === 'all' || !s)
    ? catalogList
    : catalogList.filter(v => (v.category && v.category.toLowerCase() === s) || (Array.isArray(v.tags) && v.tags.includes(s)) || (v.slug && v.slug.includes(s)));

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
    source: 'mykamababa',
    videos
  };
}

/**
 * In-memory keyword search across titles, slugs, categories, and tags with direct streamUrl attached
 */
function searchVideos(query, page = 1, limit = 20) {
  checkAutoReload();
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
    source: 'mykamababa',
    videos
  };
}

/**
 * Background Ingest & Harvester Engine
 * Protected by Mandatory Production Fix #5: Mutex lock (isSyncing)
 * Uses paced crawling (2.5s delay) to ensure Cloudflare never flags our VPS IP.
 */
async function syncCatalog(maxPages = 3, maxVideosPerPage = 30) {
  if (isSyncing) {
    return { ok: false, error: 'Sync already in progress (Mutex Locked)' };
  }

  isSyncing = true;
  console.log(`[KamaBaba Sync] Starting catalog sync (Pages: 1 to ${maxPages})...`);

  let addedCount = 0;
  let totalChecked = 0;

  try {
    for (let page = 1; page <= maxPages; page++) {
      const pageUrl = page === 1 ? 'https://www.mykamababa.com/' : `https://www.mykamababa.com/page/${page}/`;
      console.log(`[KamaBaba Sync] Scraping page ${page}: ${pageUrl}`);

      const listing = await getPostsFromListingPage(pageUrl);
      if (!listing.ok || !listing.items || listing.items.length === 0) {
        console.warn(`[KamaBaba Sync] Page ${page} returned no items. Skipping.`);
        continue;
      }

      const itemsToProcess = listing.items.slice(0, maxVideosPerPage);

      for (const item of itemsToProcess) {
        totalChecked++;

        // If video is already verified and saved, skip refetching
        const existing = catalogList.find(v => v.postUrl === item.postUrl);
        if (existing && existing.streamUrl) {
          continue;
        }

        // Paced extraction (2.5s gentle delay)
        await new Promise(r => setTimeout(r, 2500));

        const extracted = await extractVideoFromPost(item.postUrl);
        if (extracted && extracted.ok && extracted.streamUrl) {
          upsertVideo(extracted);
          addedCount++;
          console.log(`[KamaBaba Sync] (+${addedCount}) Verified: "${extracted.title.substring(0, 35)}..." [Tier ${extracted.tier}]`);
        } else {
          console.warn(`[KamaBaba Sync] Extraction failed for ${item.postUrl}:`, extracted.error || 'Unknown');
        }
      }

      // Inter-page gentle cooldown
      await new Promise(r => setTimeout(r, 3000));
    }

    if (addedCount > 0) {
      saveCatalog();
      console.log(`[KamaBaba Sync] Successfully saved ${addedCount} new videos to disk. Total library: ${catalogMap.size}`);
    } else {
      console.log(`[KamaBaba Sync] Completed. No new videos needed adding. Total library: ${catalogMap.size}`);
    }

    return {
      ok: true,
      added: addedCount,
      totalChecked,
      totalCatalog: catalogMap.size
    };
  } catch (err) {
    console.error('[KamaBaba Sync] Error during sync:', err.message);
    return { ok: false, error: err.message, added: addedCount, totalCatalog: catalogMap.size };
  } finally {
    isSyncing = false;
  }
}

/**
 * Fast recommendation engine for KamaBaba videos
 * Matches category, tags, and title keywords with zero-latency in-memory lookup
 */
function getRelatedVideos(currentId, category = '', title = '', limit = 12) {
  checkAutoReload();
  if (!catalogList || catalogList.length === 0) return [];

  const s = (category || '').toLowerCase().trim();
  const titleWords = (title || '').toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !['video', 'full', 'leak', 'desi', 'mms', 'part', 'indian', 'hindi', 'watch'].includes(w));

  const matched = [];
  const seenIds = new Set([String(currentId)]);

  // 1. Keyword / category match
  for (let i = 0; i < catalogList.length; i++) {
    const v = catalogList[i];
    if (seenIds.has(String(v.id))) continue;

    let match = false;
    if (s && s !== 'all') {
      if ((v.category && v.category.toLowerCase() === s) ||
          (Array.isArray(v.tags) && v.tags.some(t => String(t).toLowerCase() === s)) ||
          (v.slug && v.slug.includes(s))) {
        match = true;
      }
    }

    if (!match && titleWords.length > 0) {
      const vText = `${v.title || ''} ${v.slug || ''}`.toLowerCase();
      if (titleWords.some(w => vText.includes(w))) {
        match = true;
      }
    }

    if (match) {
      seenIds.add(String(v.id));
      matched.push(v);
      if (matched.length >= limit * 2) break;
    }
  }

  // 2. Shuffle / pick up to limit
  matched.sort(() => Math.random() - 0.5);
  const results = matched.slice(0, limit);

  // 3. Backfill if needed
  if (results.length < limit) {
    const randOffset = Math.floor(Math.random() * Math.max(1, catalogList.length - limit));
    for (let i = randOffset; i < catalogList.length && results.length < limit; i++) {
      const v = catalogList[i];
      if (!seenIds.has(String(v.id))) {
        seenIds.add(String(v.id));
        results.push(v);
      }
    }
  }

  return results;
}

// Initial catalog load on module import
loadCatalog();

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
  getRelatedVideos,
  syncCatalog,
  isSyncing: () => isSyncing,
  getCatalogSize: () => {
    checkAutoReload();
    return catalogMap.size;
  }
};
