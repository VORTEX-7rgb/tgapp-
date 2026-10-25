const fs = require('fs');
const path = require('path');
const { getListingPage, resolveVideo } = require('./upskirt_scraper');

const CATALOG_PATH = path.join(__dirname, 'data', 'upskirt_catalog.json');

let catalog = [];
let isSyncing = false;

const CATEGORIES = [
  { name: '🔥 Latest Videos', slug: 'latest' },
  { name: 'Indian', slug: 'indian' },
  { name: 'MILF', slug: 'milf' },
  { name: 'Amateur', slug: 'amateur' },
  { name: 'Rough Sex', slug: 'rough-sex' },
  { name: 'Big Ass', slug: 'big-ass' },
  { name: 'Brunette', slug: 'brunette' },
  { name: 'Teen', slug: 'teen' },
  { name: 'Straight', slug: 'straight' }
];

function loadCatalog() {
  try {
    if (!fs.existsSync(CATALOG_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    const data = JSON.parse(raw || '[]');
    const standardized = data.map(v => ({
      ...v,
      type: 'mp4',
      streamUrl: `/api/ut/stream/${v.numericId}.mp4`,
      directStreamUrl: `/api/ut/stream/${v.numericId}.mp4`
    }));
    console.log(`[Upskirt Catalog] Loaded ${standardized.length} videos with permanent virtual stream URLs into RAM.`);
    return standardized;
  } catch (err) {
    console.error('[Upskirt Catalog] Read error:', err.message);
    return [];
  }
}

function saveCatalog(videos) {
  try {
    const dir = path.dirname(CATALOG_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(videos, null, 2), 'utf8');
    catalog = videos;
  } catch (err) {
    console.error('[Upskirt Catalog] Save error:', err.message);
  }
}

// Initialize catalog from disk
catalog = loadCatalog();

/**
 * Concurrently resolves stream info for a batch of videos
 */
async function resolveBatch(cards, concurrency = 4) {
  const results = [];
  const queue = [...cards];

  async function worker() {
    while (queue.length > 0) {
      const card = queue.shift();
      try {
        const stream = await resolveVideo(card.numericId);
        if (stream && stream.streamUrl) {
          results.push({
            ...card,
            ...stream,
            title: card.title
          });
        } else {
          results.push(card);
        }
      } catch (e) {
        results.push(card);
      }
      await new Promise(r => setTimeout(r, 60));
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Syncs catalog by scraping pages from upskirt.tv
 */
async function syncCatalog(pages = 5) {
  if (isSyncing) {
    console.log('[Upskirt Sync] Sync already in progress.');
    return catalog;
  }

  isSyncing = true;
  console.log(`[Upskirt Sync] Starting ingestion for ${pages} pages...`);

  try {
    const allCards = [];
    const seenIds = new Set();

    for (let p = 1; p <= pages; p++) {
      try {
        console.log(`[Upskirt Sync] Scraping page ${p}...`);
        const { videos } = await getListingPage(p);
        for (const v of videos) {
          if (!seenIds.has(v.numericId)) {
            seenIds.add(v.numericId);
            allCards.push(v);
          }
        }
      } catch (e) {
        console.warn(`[Upskirt Sync] Page ${p} failed:`, e.message);
      }
      await new Promise(r => setTimeout(r, 150));
    }

    console.log(`[Upskirt Sync] Scraped ${allCards.length} unique cards. Resolving stream info for hot window...`);
    // Pre-resolve stream for top 30 videos so they play with 0ms latency
    const hotWindow = allCards.slice(0, 30);
    const coldWindow = allCards.slice(30);

    const resolvedHot = await resolveBatch(hotWindow, 4);

    // Merge with existing catalog to preserve any older cached items
    const mergedMap = new Map();
    for (const v of catalog) mergedMap.set(v.numericId, v);
    for (const v of coldWindow) mergedMap.set(v.numericId, v);
    for (const v of resolvedHot) mergedMap.set(v.numericId, v);

    const updatedCatalog = Array.from(mergedMap.values());
    saveCatalog(updatedCatalog);
    console.log(`[Upskirt Sync] Completed. Catalog size: ${updatedCatalog.length} videos.`);
    return updatedCatalog;
  } catch (err) {
    console.error('[Upskirt Sync] Fatal error during sync:', err.message);
    return catalog;
  } finally {
    isSyncing = false;
  }
}

/**
 * Returns paginated browse results from RAM with live fallback if catalog is empty
 */
function getUtBrowse(page = 1, limit = 24) {
  const start = (page - 1) * limit;
  const end = start + limit;
  const items = catalog.slice(start, end);
  const total = catalog.length;
  const totalPages = Math.ceil(total / limit) || 1;

  return {
    ok: true,
    videos: items,
    page,
    limit,
    total,
    totalPages,
    source: 'upskirt'
  };
}

/**
 * Searches the Upskirt catalog by title or keyword
 */
function searchUtVideos(query = '', page = 1, limit = 24) {
  const cleanQ = query.toLowerCase().trim();
  if (!cleanQ) return getUtBrowse(page, limit);

  // Resilient query normalization (sweety -> sweetie, gattouzo -> gattouz0, comatoz -> commatoz)
  const normQ = cleanQ
    .replace(/sweety/g, 'sweetie')
    .replace(/gattouzo/g, 'gattouz0')
    .replace(/comatoz/g, 'commatoz');
  const noSpaces = normQ.replace(/[^a-z0-9]/g, '');

  const matched = catalog.filter(v => {
    const t = (v.title || '').toLowerCase();
    const s = (v.slug || '').toLowerCase();
    const p = (v.performer || '').toLowerCase();
    const tags = Array.isArray(v.tags) ? v.tags.join(' ').toLowerCase() : '';
    const pClean = p.replace(/[^a-z0-9]/g, '');
    const tClean = t.replace(/[^a-z0-9]/g, '');
    return t.includes(cleanQ) || s.includes(cleanQ) || p.includes(cleanQ) ||
           t.includes(normQ) || s.includes(normQ) || p.includes(normQ) ||
           pClean.includes(noSpaces) || tags.includes(cleanQ) || tags.includes(normQ) ||
           tags.includes(noSpaces) || tClean.includes(noSpaces);
  });

  const start = (page - 1) * limit;
  const end = start + limit;
  const items = matched.slice(start, end);

  return {
    ok: true,
    videos: items,
    page,
    limit,
    total: matched.length,
    totalPages: Math.ceil(matched.length / limit) || 1,
    query,
    source: 'upskirt'
  };
}

/**
 * Gets or on-demand resolves stream info for a given video ID
 */
async function getOrResolveUtStream(idOrNumeric, force = false) {
  const numericId = String(idOrNumeric).replace(/^ut-/, '');
  
  // Check RAM catalog first
  let item = catalog.find(v => v.numericId === numericId || v.id === idOrNumeric);
  const now = Math.floor(Date.now() / 1000);

  // If item already has a valid raw upstream URL that is not expired
  if (!force && item && item.upstreamUrl && item.expiresAt && (item.expiresAt - now > 300)) {
    return item;
  }

  // Resolve on-demand from API in <200ms
  console.log(`[Upskirt Stream] Resolving upstream stream for ID ${numericId}...`);
  const resolved = await resolveVideo(numericId);
  if (resolved && resolved.streamUrl) {
    const upstreamUrl = resolved.streamUrl;
    const permanentVirtualUrl = `/api/ut/stream/${numericId}.mp4`;
    const merged = {
      ...resolved,
      upstreamUrl,
      streamUrl: permanentVirtualUrl,
      directStreamUrl: permanentVirtualUrl
    };
    if (item) {
      Object.assign(item, merged);
    } else {
      item = {
        id: `ut-${numericId}`,
        numericId,
        ...merged
      };
      catalog.unshift(item);
    }
    // Update disk asynchronously
    saveCatalog(catalog);
    return { ...item, upstreamUrl };
  }

  return item || null;
}

function getRelatedVideos(currentId, category = '', title = '', limit = 12) {
  if (!catalog || catalog.length === 0) return [];
  const candidates = catalog.filter(v => v.id !== currentId && v.numericId !== currentId);
  if (candidates.length <= limit) return candidates;

  const s = (category || '').toLowerCase().trim();
  const matched = candidates.filter(v => {
    if (s && ((v.category && v.category.toLowerCase().includes(s)) || (Array.isArray(v.tags) && v.tags.some(t => String(t).toLowerCase().includes(s))))) {
      return true;
    }
    return false;
  });

  const remaining = candidates.filter(v => !matched.includes(v));
  const combined = [...matched, ...remaining];
  return combined.slice(0, limit);
}

module.exports = {
  loadCatalog,
  saveCatalog,
  syncCatalog,
  getUtBrowse,
  searchUtVideos,
  getOrResolveUtStream,
  getRelatedVideos,
  CATEGORIES,
  getCatalog: () => catalog,
  isSyncing: () => isSyncing
};
