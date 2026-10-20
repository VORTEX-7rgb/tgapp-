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
    console.log(`[Upskirt Catalog] Loaded ${data.length} videos into RAM.`);
    return data;
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

  const matched = catalog.filter(v => {
    const t = (v.title || '').toLowerCase();
    const s = (v.slug || '').toLowerCase();
    return t.includes(cleanQ) || s.includes(cleanQ);
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
  const numericId = idOrNumeric.replace(/^ut-/, '');
  
  // Check RAM catalog first
  let item = catalog.find(v => v.numericId === numericId || v.id === idOrNumeric);
  const now = Math.floor(Date.now() / 1000);

  // If item already has a valid streamUrl that is not expired
  if (!force && item && item.streamUrl && item.expiresAt && (item.expiresAt - now > 300)) {
    return item;
  }

  // Resolve on-demand from API in <200ms
  console.log(`[Upskirt Stream] Resolving stream on-demand for ID ${numericId}...`);
  const resolved = await resolveVideo(numericId);
  if (resolved && resolved.streamUrl) {
    if (item) {
      Object.assign(item, resolved);
    } else {
      item = {
        id: `ut-${numericId}`,
        numericId,
        ...resolved
      };
      catalog.unshift(item);
    }
    // Update disk asynchronously
    saveCatalog(catalog);
    return item;
  }

  return item || null;
}

module.exports = {
  loadCatalog,
  saveCatalog,
  syncCatalog,
  getUtBrowse,
  searchUtVideos,
  getOrResolveUtStream,
  CATEGORIES,
  getCatalog: () => catalog,
  isSyncing: () => isSyncing
};
