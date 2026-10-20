const fs = require('fs');
const path = require('path');
const { getListingPage, resolveVideo } = require('./usersporn_scraper');

const CATALOG_PATH = path.join(__dirname, 'data', 'usersporn_catalog.json');
const HOT_WINDOW_LIMIT = 150; // Refinement 2: Bounded Hot Window (Top 150 videos refreshed every 3.5h)

let catalog = [];
let isSyncing = false;
let refresherInterval = null;

const CATEGORIES = [
  { name: '🔥 Latest Videos', slug: '' },
  { name: 'Amateur & Leaks', slug: 'amateur' },
  { name: 'Desi & Asian', slug: 'desi' },
  { name: 'Hardcore', slug: 'hardcore' },
  { name: 'Solo & Cam', slug: 'solo' },
  { name: 'Verified HD', slug: 'hd' }
];

function loadCatalog() {
  try {
    if (!fs.existsSync(CATALOG_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    const data = JSON.parse(raw || '[]');
    console.log(`[UsersPorn Catalog] Loaded ${data.length} videos into RAM.`);
    return data;
  } catch (err) {
    console.error('[UsersPorn Catalog] Read error:', err.message);
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
    console.error('[UsersPorn Catalog] Save error:', err.message);
  }
}

// Initialize from disk
catalog = loadCatalog();

/**
 * Concurrently resolves a batch of video cards with bounded concurrency
 */
async function resolveBatch(cards, concurrency = 4) {
  const results = [];
  const queue = [...cards];

  async function worker() {
    while (queue.length > 0) {
      const card = queue.shift();
      try {
        const stream = await resolveVideo(card.rawId);
        if (stream && stream.streamUrl) {
          results.push({
            ...card,
            ...stream,
            title: stream.title || card.title
          });
          console.log(`[UsersPorn Ingest] ✅ (${results.length}) ${card.title.slice(0, 40)} -> ${stream.defaultQuality} (${stream.qualities.join('/')})`);
        }
      } catch (e) {
        console.warn(`[UsersPorn Ingest] ❌ Failed ${card.rawId}:`, e.message);
      }
      await new Promise(r => setTimeout(r, 100)); // Gentle throttling
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
async function syncCatalog(pages = 30) {
  if (isSyncing) {
    console.log('[UsersPorn Sync] Sync already running (locked).');
    return catalog;
  }

  isSyncing = true;
  console.log(`[UsersPorn Sync] Starting ingestion for ${pages} pages...`);

  try {
    const allCards = [];
    const seenIds = new Set();

    for (let p = 1; p <= pages; p++) {
      try {
        const cards = await getListingPage(p);
        for (const c of cards) {
          if (!seenIds.has(c.rawId)) {
            seenIds.add(c.rawId);
            allCards.push(c);
          }
        }
      } catch (err) {
        console.warn(`[UsersPorn Sync] Error fetching page ${p}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 60)); // Fast pagination
    }

    console.log(`[UsersPorn Sync] Total unique cards found: ${allCards.length}. Checking Hot Window (top ${HOT_WINDOW_LIMIT})...`);
    
    // First: check existing catalog resolved streams so we don't re-fetch them unnecessarily
    const existingMap = new Map(catalog.map(v => [v.rawId, v]));
    const nowSec = Math.floor(Date.now() / 1000);

    const hotBatch = allCards.slice(0, HOT_WINDOW_LIMIT);
    // Only resolve items in hotBatch that don't have a valid stream or expire soon
    const needResolve = hotBatch.filter(c => {
      const existing = existingMap.get(c.rawId);
      return !existing || !existing.streamUrl || !existing.expiresAt || (existing.expiresAt - nowSec < 7200);
    });

    console.log(`[UsersPorn Sync] Resolving ${needResolve.length} Hot Window items concurrently...`);
    const freshlyResolved = await resolveBatch(needResolve, 4);
    const freshMap = new Map(freshlyResolved.map(v => [v.rawId, v]));

    // Build the complete combined catalog:
    // 1. All hotBatch cards (with fresh or existing valid streamUrl)
    // 2. All remaining cold cards from allCards (with metadata: title, thumb, rawThumb, duration, postUrl, type: 'mp4')
    // 3. Any previous catalog cards not in current scrape
    const finalCatalog = [];
    const finalSeen = new Set();

    for (const card of allCards) {
      if (finalSeen.has(card.rawId)) continue;
      finalSeen.add(card.rawId);

      if (freshMap.has(card.rawId)) {
        finalCatalog.push(freshMap.get(card.rawId));
      } else if (existingMap.has(card.rawId) && existingMap.get(card.rawId).streamUrl) {
        finalCatalog.push({ ...card, ...existingMap.get(card.rawId) });
      } else {
        // Cold archive item!
        finalCatalog.push({
          ...card,
          type: 'mp4'
        });
      }
    }

    // Keep any older historical items
    for (const existing of catalog) {
      if (!finalSeen.has(existing.rawId)) {
        finalSeen.add(existing.rawId);
        finalCatalog.push(existing);
      }
    }

    saveCatalog(finalCatalog);
    console.log(`[UsersPorn Sync] ✅ Sync complete! Catalog size: ${finalCatalog.length} videos (Hot Window: ${hotBatch.length}).`);
    return finalCatalog;
  } catch (err) {
    console.error('[UsersPorn Sync Error]:', err.message);
    return catalog;
  } finally {
    isSyncing = false;
  }
}

/**
 * Lazy On-Demand Stream Resolver for Cold Archive items
 */
async function getOrResolveStream(id, force = false) {
  let video = catalog.find(v => v.id === id || v.rawId === id);
  if (!video) {
    const rawId = String(id).replace(/^up-/, '');
    video = catalog.find(v => v.rawId === rawId);
    if (!video) {
      try {
        const stream = await resolveVideo(rawId);
        if (stream && stream.streamUrl) {
          video = {
            id: `up-${rawId}`,
            rawId,
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

  // Token is expired, missing, or force was requested - resolve on demand
  console.log(`[UsersPorn On-Demand] Resolving fresh token for ${video.rawId} (force: ${force})...`);
  try {
    const fresh = await resolveVideo(video.rawId);
    if (fresh && fresh.streamUrl) {
      Object.assign(video, fresh);
      saveCatalog(catalog);
      return video;
    }
  } catch (err) {
    console.error(`[UsersPorn On-Demand Error] ${video.rawId}:`, err.message);
  }

  return video;
}

/**
 * Bounded Background Refresher:
 * Checks the top 150 videos every 20 minutes. If token expires in < 75 minutes (4500s), refreshes it silently.
 */
async function checkAndRefreshHotTokens() {
  if (isSyncing || catalog.length === 0) return;
  const nowSec = Math.floor(Date.now() / 1000);
  const hotWindow = catalog.slice(0, HOT_WINDOW_LIMIT);
  
  // Find videos needing refresh (less than 75 minutes left)
  const expiring = hotWindow.filter(v => !v.expiresAt || (v.expiresAt - nowSec < 4500));
  if (expiring.length === 0) {
    console.log(`[UsersPorn Refresher] Hot Window tokens healthy (valid for > 75 minutes).`);
    return;
  }

  console.log(`[UsersPorn Refresher] Refreshing ${expiring.length} expiring Hot Window tokens silently...`);
  for (const item of expiring.slice(0, 20)) { // Refresh in small chunks of 20
    try {
      const fresh = await resolveVideo(item.rawId);
      if (fresh && fresh.streamUrl) {
        item.streamUrl = fresh.streamUrl;
        item.qualityUrls = fresh.qualityUrls;
        item.expiresAt = fresh.expiresAt;
        item.verifiedAt = Date.now();
      }
    } catch (e) {
      // Silent catch; don't break playback
    }
    await new Promise(r => setTimeout(r, 200));
  }

  saveCatalog(catalog);
}

function startAutoRefresher() {
  if (refresherInterval) clearInterval(refresherInterval);
  // Check every 20 minutes
  refresherInterval = setInterval(() => {
    checkAndRefreshHotTokens().catch(() => {});
  }, 20 * 60 * 1000);
  console.log('[UsersPorn Refresher] Background Hot Window token refresher active (20min interval, 75min threshold).');
}

// ==========================================
// Public Fast RAM Query Methods
// ==========================================

function sanitizeVideoForClient(v) {
  if (!v) return v;
  const nowSec = Math.floor(Date.now() / 1000);
  const isExpired = !v.expiresAt || (v.expiresAt <= nowSec + 300);
  if (isExpired) {
    return {
      ...v,
      streamUrl: null,
      qualities: null,
      qualityUrls: null
    };
  }
  return v;
}

function getBrowseVideos(page = 1, limit = 20) {
  const start = (page - 1) * limit;
  const end = start + limit;
  const slice = catalog.slice(start, end).map(sanitizeVideoForClient);
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
    const text = `${v.title || ''} ${v.postUrl || ''}`.toLowerCase();
    return text.includes(slug.toLowerCase());
  });

  const start = (page - 1) * limit;
  const end = start + limit;
  const slice = matched.slice(start, end).map(sanitizeVideoForClient);
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
    const text = `${v.title || ''} ${v.postUrl || ''}`.toLowerCase();
    return terms.every(t => text.includes(t));
  });

  const start = (page - 1) * limit;
  const end = start + limit;
  const slice = matched.slice(start, end).map(sanitizeVideoForClient);
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
  return catalog.find(v => v.id === id || v.rawId === id);
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
