const fs = require('fs');
const path = require('path');
const { getListingPage, resolveVideo } = require('./cumlouder_scraper');

const CATALOG_PATH = path.join(__dirname, 'data', 'cumlouder_catalog.json');
const HOT_WINDOW_LIMIT = 150; // Hot Window: Top 150 videos refreshed in RAM

let catalog = [];
let isSyncing = false;
let refresherInterval = null;

const CATEGORIES = [
  { name: '🔥 Latest Videos', slug: '' },
  { name: 'MILF', slug: 'milf' },
  { name: 'Teen', slug: 'teen' },
  { name: 'Latina', slug: 'latina' },
  { name: 'Spanish', slug: 'spanish' },
  { name: 'Big Dick', slug: 'big-dick' },
  { name: 'Anal', slug: 'anal' },
  { name: 'Hard Sex', slug: 'hard-sex' }
];

function loadCatalog() {
  try {
    if (!fs.existsSync(CATALOG_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    const data = JSON.parse(raw || '[]');
    console.log(`[Cumlouder Catalog] Loaded ${data.length} videos into RAM.`);
    return data;
  } catch (err) {
    console.error('[Cumlouder Catalog] Read error:', err.message);
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
    console.error('[Cumlouder Catalog] Save error:', err.message);
  }
}

// Initialize from disk
catalog = loadCatalog();

/**
 * Concurrently resolves a batch of video cards with bounded concurrency
 * Uses Upgrade 1: uses numericId if already known to fetch lightweight /embed/{id}/ in <400ms
 */
async function resolveBatch(cards, concurrency = 4) {
  const results = [];
  const queue = [...cards];

  async function worker() {
    while (queue.length > 0) {
      const card = queue.shift();
      try {
        const stream = await resolveVideo(card.slug, card.numericId);
        if (stream && (stream.streamUrl || stream.embedUrl)) {
          results.push({
            ...card,
            ...stream,
            title: card.title || stream.title
          });
          console.log(`[Cumlouder Ingest] ✅ (${results.length}) ${card.title.slice(0, 35)} -> ${stream.streamUrl ? 'Direct MP4' : 'Embed'}`);
        }
      } catch (e) {
        console.warn(`[Cumlouder Ingest] ❌ Failed ${card.slug}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 60)); // Fast pagination
    }
  }

  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Sync Catalog: Scrapes listing pages, resolves Hot Window, and saves to disk
 * Retains Cold Archive (thousands of videos) with full metadata for search & pagination
 */
async function syncCatalog(pages = 20) {
  if (isSyncing) {
    console.log('[Cumlouder Sync] Sync already running (locked).');
    return catalog;
  }

  isSyncing = true;
  console.log(`[Cumlouder Sync] Starting ingestion for ${pages} pages...`);

  try {
    const allCards = [];
    const seenSlugs = new Set();

    for (let p = 1; p <= pages; p++) {
      try {
        const cards = await getListingPage(p);
        for (const c of cards) {
          if (!seenSlugs.has(c.slug)) {
            seenSlugs.add(c.slug);
            allCards.push(c);
          }
        }
      } catch (err) {
        console.warn(`[Cumlouder Sync] Error fetching page ${p}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 50));
    }

    console.log(`[Cumlouder Sync] Total unique cards found: ${allCards.length}. Checking Hot Window (top ${HOT_WINDOW_LIMIT})...`);

    const existingMap = new Map(catalog.map(v => [v.slug, v]));
    const nowSec = Math.floor(Date.now() / 1000);

    const hotBatch = allCards.slice(0, HOT_WINDOW_LIMIT);
    // Only resolve items in hotBatch that lack a valid stream or expire soon (< 2 hours)
    const needResolve = hotBatch.filter(c => {
      const existing = existingMap.get(c.slug);
      return !existing || !existing.streamUrl || !existing.expiresAt || (existing.expiresAt - nowSec < 7200);
    });

    console.log(`[Cumlouder Sync] Resolving ${needResolve.length} Hot Window items concurrently...`);
    const freshlyResolved = await resolveBatch(needResolve, 4);
    const freshMap = new Map(freshlyResolved.map(v => [v.slug, v]));

    const finalCatalog = [];
    const finalSeen = new Set();

    for (const card of allCards) {
      if (finalSeen.has(card.slug)) continue;
      finalSeen.add(card.slug);

      if (freshMap.has(card.slug)) {
        finalCatalog.push(freshMap.get(card.slug));
      } else if (existingMap.has(card.slug) && existingMap.get(card.slug).streamUrl) {
        finalCatalog.push({ ...card, ...existingMap.get(card.slug) });
      } else {
        // Cold archive item!
        const existing = existingMap.get(card.slug);
        finalCatalog.push({
          ...card,
          numericId: existing ? existing.numericId : null,
          embedUrl: existing ? existing.embedUrl : null,
          type: 'mp4'
        });
      }
    }

    // Keep any historical items
    for (const existing of catalog) {
      if (!finalSeen.has(existing.slug)) {
        finalSeen.add(existing.slug);
        finalCatalog.push(existing);
      }
    }

    saveCatalog(finalCatalog);
    console.log(`[Cumlouder Sync] ✅ Sync complete! Catalog size: ${finalCatalog.length} videos (Hot Window: ${hotBatch.length}).`);
    return finalCatalog;
  } catch (err) {
    console.error('[Cumlouder Sync Error]:', err.message);
    return catalog;
  } finally {
    isSyncing = false;
  }
}

/**
 * Lazy On-Demand Stream Resolver for Cold Archive items
 * Upgrade 1: uses numericId if known to resolve in <400ms from /embed/{id}/
 */
async function getOrResolveStream(id, force = false) {
  let video = catalog.find(v => v.id === id || v.slug === id);
  if (!video) {
    const slug = String(id).replace(/^cl-/, '');
    video = catalog.find(v => v.slug === slug);
    if (!video) {
      try {
        const stream = await resolveVideo(slug);
        if (stream && (stream.streamUrl || stream.embedUrl)) {
          video = {
            id: `cl-${slug}`,
            slug,
            ...stream
          };
          catalog.unshift(video);
          saveCatalog(catalog);
          return video;
        }
      } catch (e) {
        return null;
      }
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (!force && video.streamUrl && video.expiresAt && (video.expiresAt - nowSec > 300)) {
    return video;
  }

  // Token is expired or was cold - resolve on demand
  console.log(`[Cumlouder On-Demand] Resolving stream for ${video.slug} (numericId: ${video.numericId || 'unknown'})...`);
  try {
    const fresh = await resolveVideo(video.slug, video.numericId);
    if (fresh && (fresh.streamUrl || fresh.embedUrl)) {
      Object.assign(video, fresh);
      saveCatalog(catalog);
      return video;
    }
  } catch (err) {
    console.error(`[Cumlouder On-Demand Error] ${video.slug}:`, err.message);
  }

  return video;
}

/**
 * Bounded Background Refresher (Hot Window Rule):
 * Checks the top 150 videos every 30 minutes. If token expires in < 2.5 hours, refreshes it silently.
 * Upgrade 1: Uses /embed/{numericId}/ for fast 300ms refresh
 */
async function checkAndRefreshHotTokens() {
  if (isSyncing || catalog.length === 0) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const hotWindow = catalog.slice(0, HOT_WINDOW_LIMIT);

  // Find videos needing refresh (less than 2.5 hours left)
  const expiring = hotWindow.filter(v => v.expiresAt && (v.expiresAt - nowSec < 9000));
  if (expiring.length === 0) {
    console.log(`[Cumlouder Refresher] Hot Window tokens healthy (valid for > 2.5 hours).`);
    return;
  }

  console.log(`[Cumlouder Refresher] Refreshing ${expiring.length} expiring Hot Window tokens silently...`);
  for (const item of expiring.slice(0, 20)) {
    try {
      const fresh = await resolveVideo(item.slug, item.numericId);
      if (fresh && fresh.streamUrl) {
        item.streamUrl = fresh.streamUrl;
        item.embedUrl = fresh.embedUrl || item.embedUrl;
        item.numericId = fresh.numericId || item.numericId;
        item.expiresAt = fresh.expiresAt;
        item.verifiedAt = Date.now();
      }
    } catch (e) {
      // Silent catch
    }
    await new Promise(r => setTimeout(r, 100));
  }

  saveCatalog(catalog);
}

function startAutoRefresher() {
  if (refresherInterval) clearInterval(refresherInterval);
  refresherInterval = setInterval(() => {
    checkAndRefreshHotTokens().catch(() => {});
  }, 30 * 60 * 1000);
  console.log('[Cumlouder Refresher] Background Hot Window token refresher active (30min interval).');
}

// ==========================================
// Public Fast RAM Query Methods
// ==========================================

function getBrowseVideos(page = 1, limit = 20) {
  const start = (page - 1) * limit;
  const end = start + limit;
  const slice = catalog.slice(start, end);
  const totalPages = Math.ceil(catalog.length / limit) || 1;

  return {
    ok: true,
    page: Number(page),
    totalPages,
    totalVideos: catalog.length,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    videos: slice
  };
}

function getCategoryVideos(slug, page = 1, limit = 20) {
  if (!slug) return getBrowseVideos(page, limit);

  const matched = catalog.filter(v => {
    const text = `${v.title || ''} ${v.slug || ''} ${v.postUrl || ''}`.toLowerCase();
    return text.includes(slug.toLowerCase());
  });

  const start = (page - 1) * limit;
  const end = start + limit;
  const slice = matched.slice(start, end);
  const totalPages = Math.ceil(matched.length / limit) || 1;

  return {
    ok: true,
    category: slug,
    page: Number(page),
    totalPages,
    totalVideos: matched.length,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    videos: slice
  };
}

function searchVideos(query = '', page = 1, limit = 20) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return getBrowseVideos(page, limit);

  const matched = catalog.filter(v => {
    const text = `${v.title || ''} ${v.slug || ''} ${v.postUrl || ''}`.toLowerCase();
    return terms.every(t => text.includes(t));
  });

  const start = (page - 1) * limit;
  const end = start + limit;
  const slice = matched.slice(start, end);
  const totalPages = Math.ceil(matched.length / limit) || 1;

  return {
    ok: true,
    query,
    page: Number(page),
    totalPages,
    totalVideos: matched.length,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    videos: slice
  };
}

function getVideoById(id) {
  return catalog.find(v => v.id === id || v.slug === id);
}

function getCatalogSize() {
  return catalog.length;
}

module.exports = {
  CATEGORIES,
  syncCatalog,
  startAutoRefresher,
  getBrowseVideos,
  getCategoryVideos,
  searchVideos,
  getVideoById,
  getOrResolveStream,
  getCatalogSize,
  isSyncing: () => isSyncing
};
