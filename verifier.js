const https = require('https');
const fs = require('fs');
const path = require('path');
const { getDirectStream, httpGet, USER_AGENT } = require('./scraper');

const CATALOG_PATH = process.env.VERCEL 
  ? path.join('/tmp', 'verified_catalog.json') 
  : path.join(__dirname, 'data', 'verified_catalog.json');

// Ensure data folder exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

function getLocalCatalog() {
  try {
    if (process.env.VERCEL && !fs.existsSync(CATALOG_PATH)) {
      const seedPath = path.join(__dirname, 'data', 'verified_catalog.json');
      if (fs.existsSync(seedPath)) {
        try {
          fs.writeFileSync(CATALOG_PATH, fs.readFileSync(seedPath, 'utf8'));
        } catch (e) {}
      }
    }
    if (!fs.existsSync(CATALOG_PATH)) {
      return [];
    }
    const raw = fs.readFileSync(CATALOG_PATH, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('[Catalog Error] Read failed:', err.message);
    return [];
  }
}

function saveLocalCatalog(videos) {
  try {
    fs.writeFileSync(CATALOG_PATH, JSON.stringify(videos, null, 2), 'utf8');
  } catch (err) {
    console.error('[Catalog Error] Save failed:', err.message);
  }
}

function checkSegment(url, referer) {
  return new Promise(resolve => {
    try {
      const parsed = new URL(url);
      const isLulu = parsed.hostname.includes('tnmr.org') || parsed.hostname.includes('lulu');
      const ref = referer || (isLulu ? 'https://luluvido.com/' : 'https://playmate.to/');
      const origin = ref.replace(/\/$/, '');

      const req = https.get({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
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
          'Referer': ref,
          'Origin': origin
        },
        timeout: 6000
      }, res => {
        let len = Number(res.headers['content-length'] || 0);
        let chunks = [];
        res.on('data', c => {
          chunks.push(c);
          const total = chunks.reduce((a, b) => a + b.length, 0);
          if (total > 200000) {
            req.destroy(); // Captured enough to verify legitimate media
          }
        });
        res.on('close', () => {
          const total = chunks.reduce((a, b) => a + b.length, 0);
          const firstByte = chunks[0] ? chunks[0][0] : null;
          // Valid video segment: status 200 or 206, > 50KB, and valid sync byte or verified encrypted media
          const isReal = (res.statusCode === 200 || res.statusCode === 206) && total > 50000 && (firstByte === 0x47 || firstByte === 0x00 || firstByte === 0x49 || total > 150000);
          resolve({
            status: res.statusCode,
            length: len || total,
            isRealVideo: isReal
          });
        });
      });
      req.on('error', e => resolve({ error: e.message, isRealVideo: false }));
      req.on('timeout', () => { req.destroy(); resolve({ timeout: true, isRealVideo: false }); });
    } catch (err) {
      resolve({ error: err.message, isRealVideo: false });
    }
  });
}

async function verifyVideo(v) {
  const t0 = Date.now();
  try {
    const stream = await getDirectStream(v.url);
    if (!stream || !stream.ok || !stream.rawUrl) {
      return { ok: false, reason: 'No stream extracted' };
    }

    const parsed = new URL(stream.rawUrl);
    const isLulu = parsed.hostname.includes('tnmr.org') || parsed.hostname.includes('lulu');
    const referer = isLulu ? 'https://luluvido.com/' : 'https://playmate.to/';

    // 1. Fetch master playlist using httpGet
    let master = '';
    try {
      master = await httpGet(stream.rawUrl, { 'Referer': referer }, 6000);
    } catch (e) {
      return { ok: false, reason: `Master playlist HTTP error: ${e.message}` };
    }

    if (!master || !master.includes('#EXTM3U')) {
      return { ok: false, reason: 'Invalid master playlist' };
    }

    // 2. Fetch subplaylist
    const lines = master.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const subUrl = lines[0] ? new URL(lines[0].trim(), stream.rawUrl).toString() : stream.rawUrl;
    let sub = '';
    try {
      sub = await httpGet(subUrl, { 'Referer': referer }, 6000);
    } catch (e) {
      return { ok: false, reason: `Subplaylist HTTP error: ${e.message}` };
    }

    // 3. Inspect first media segment
    const segLines = sub.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    if (!segLines[0]) {
      return { ok: false, reason: 'Empty segments in subplaylist' };
    }

    const segUrl = new URL(segLines[0].trim(), subUrl).toString();
    const segCheck = await checkSegment(segUrl, referer);

    if (!segCheck.isRealVideo) {
      return { ok: false, reason: `Defective chunk (${segCheck.length} bytes, HTTP ${segCheck.status})` };
    }

    return {
      ok: true,
      timeMs: Date.now() - t0,
      streamUrl: stream.streamUrl,
      rawUrl: stream.rawUrl,
      poster: stream.poster,
      segBytes: segCheck.length
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}


/**
 * Scan candidate videos for a category or browse, audit their media packets,
 * and save ONLY 100% verified playable videos into the catalog.
 */
async function auditCategory(slug, targetCount = 10) {
  const { getCategoryVideos, getBrowseVideos } = require('./scraper');
  const existing = getLocalCatalog();
  const existingUrls = new Set(existing.map(v => v.url));
  const verifiedList = [...existing];

  console.log(`[Auditor] Auditing category: "${slug || 'browse'}" (target: ${targetCount})...`);

  for (let page = 1; page <= 3; page++) {
    const currentForCat = verifiedList.filter(v => (v.category || '') === (slug || ''));
    if (currentForCat.length >= targetCount) break;

    const data = slug ? await getCategoryVideos(slug, page) : await getBrowseVideos(page);
    if (!data || !data.videos || data.videos.length === 0) continue;

    for (const v of data.videos) {
      const count = verifiedList.filter(item => (item.category || '') === (slug || '')).length;
      if (count >= targetCount) break;
      if (existingUrls.has(v.url)) continue;

      const check = await verifyVideo(v);
      if (check.ok) {
        const verifiedEntry = {
          ...v,
          category: slug || '',
          title: `Video ${count + 1}`,
          streamUrl: check.streamUrl,
          rawUrl: check.rawUrl,
          poster: check.poster || v.thumb,
          segBytes: check.segBytes,
          verifiedAt: Date.now()
        };
        verifiedList.push(verifiedEntry);
        existingUrls.add(v.url);
        console.log(`[Auditor] ✅ [${slug || 'browse'}] Verified #${count + 1}: ${v.url.slice(21, 60)} (${(check.segBytes/1024).toFixed(0)}KB, ${check.timeMs}ms)`);
        saveLocalCatalog(verifiedList);
      } else {
        console.log(`[Auditor] ❌ [${slug || 'browse'}] Rejected: ${v.url.slice(21, 60)} (${check.reason})`);
      }
    }
  }

  saveLocalCatalog(verifiedList);
  return verifiedList;
}

async function auditAndPopulateCatalog() {
  console.log(`[Auditor] Starting full multi-category catalog audit...`);
  const categoriesToAudit = [
    '', // Latest / Browse
    '18-web-series',
    'bangla-sex-videos',
    'arab-sex-videos',
    'desi-cute-girls-videos',
    'indian-desi-mms'
  ];

  for (const cat of categoriesToAudit) {
    try {
      await auditCategory(cat, 15);
    } catch (e) {
      console.error(`[Auditor Error] Category ${cat} failed:`, e.message);
    }
  }

  const catalog = getLocalCatalog();
  console.log(`[Auditor] Full audit complete! Total verified catalog size: ${catalog.length}`);
  return catalog;
}

function getVerifiedCategory(slug, page = 1, limit = 20) {
  const catalog = getLocalCatalog();
  const filtered = catalog.filter(v => (v.category || '') === (slug || ''));
  if (filtered.length === 0) return null;

  const start = (page - 1) * limit;
  const end = start + limit;
  const slice = filtered.slice(start, end);
  const totalPages = Math.ceil(filtered.length / limit) || 1;

  return {
    ok: true,
    category: slug,
    page: Number(page),
    totalPages,
    totalVideos: filtered.length,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    videos: slice.map((v, idx) => ({
      ...v,
      title: `Video ${start + idx + 1} (Page ${page})`
    }))
  };
}

function getVerifiedBrowse(page = 1, limit = 20) {
  const catalog = getLocalCatalog();
  const pool = catalog.filter(v => !v.category || v.category === '');
  const items = pool.length >= 5 ? pool : catalog;
  const start = (page - 1) * limit;
  const end = start + limit;
  const slice = items.slice(start, end);
  const totalPages = Math.ceil(items.length / limit) || 1;

  return {
    ok: true,
    page: Number(page),
    totalPages,
    totalVideos: items.length,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    videos: slice.map((v, idx) => ({
      ...v,
      title: `Video ${start + idx + 1} (Page ${page})`
    }))
  };
}

module.exports = {
  verifyVideo,
  auditCategory,
  auditAndPopulateCatalog,
  getVerifiedCategory,
  getVerifiedBrowse,
  getLocalCatalog,
  saveLocalCatalog
};
