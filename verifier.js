const https = require('https');
const fs = require('fs');
const path = require('path');
const { getDirectStream } = require('./scraper');

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

function checkSegment(url) {
  return new Promise(resolve => {
    try {
      const parsed = new URL(url);
      const req = https.get({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: 6000
      }, res => {
        let len = Number(res.headers['content-length'] || 0);
        let chunks = [];
        res.on('data', c => {
          chunks.push(c);
          const total = chunks.reduce((a, b) => a + b.length, 0);
          if (total > 200000) {
            req.destroy(); // Captured enough to verify legitimate MPEG-TS media
          }
        });
        res.on('close', () => {
          const total = chunks.reduce((a, b) => a + b.length, 0);
          const firstByte = chunks[0] ? chunks[0][0] : null;
          // Valid video segment: must be > 50KB and start with MPEG-TS sync byte 0x47 or fMP4/ID3
          const isReal = total > 50000 && (firstByte === 0x47 || firstByte === 0x00 || firstByte === 0x49);
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

    // 1. Fetch master playlist
    const master = await new Promise(r => {
      https.get(stream.rawUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000 }, res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => r(b));
      }).on('error', () => r('')).on('timeout', () => r(''));
    });

    if (!master || !master.includes('#EXTM3U')) {
      return { ok: false, reason: 'Invalid master playlist' };
    }

    // 2. Fetch subplaylist
    const lines = master.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    const subUrl = lines[0] ? new URL(lines[0].trim(), stream.rawUrl).toString() : stream.rawUrl;
    const sub = await new Promise(r => {
      https.get(subUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000 }, res => {
        let b = '';
        res.on('data', c => b += c);
        res.on('end', () => r(b));
      }).on('error', () => r('')).on('timeout', () => r(''));
    });

    // 3. Inspect first media segment
    const segLines = sub.split('\n').filter(l => l.trim() && !l.startsWith('#'));
    if (!segLines[0]) {
      return { ok: false, reason: 'Empty segments in subplaylist' };
    }

    const segUrl = new URL(segLines[0].trim(), subUrl).toString();
    const segCheck = await checkSegment(segUrl);

    if (!segCheck.isRealVideo) {
      return { ok: false, reason: `Defective chunk (${segCheck.length} bytes)` };
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
 * Scan raw pages, audit each video's media packets,
 * and save ONLY 100% verified playable videos into the catalog.
 */
async function auditAndPopulateCatalog(maxPages = 3, targetVerified = 30) {
  const { getBrowseVideos } = require('./scraper');
  const existing = getLocalCatalog();
  const existingUrls = new Set(existing.map(v => v.url));
  const verifiedList = [...existing];

  console.log(`[Auditor] Starting catalog audit. Current verified count: ${verifiedList.length}`);

  for (let page = 1; page <= maxPages; page++) {
    if (verifiedList.length >= targetVerified) break;
    console.log(`[Auditor] Scanning candidate page ${page}...`);
    const browse = await getBrowseVideos(page);
    if (!browse || !browse.videos || browse.videos.length === 0) continue;

    for (const v of browse.videos) {
      if (verifiedList.length >= targetVerified) break;
      if (existingUrls.has(v.url)) continue;

      const check = await verifyVideo(v);
      if (check.ok) {
        const verifiedEntry = {
          ...v,
          title: `Video ${verifiedList.length + 1}`,
          streamUrl: check.streamUrl,
          rawUrl: check.rawUrl,
          poster: check.poster || v.thumb,
          segBytes: check.segBytes,
          verifiedAt: Date.now()
        };
        verifiedList.push(verifiedEntry);
        existingUrls.add(v.url);
        console.log(`[Auditor] ✅ Verified #${verifiedList.length}: ${v.url.slice(21, 60)} (${check.segBytes} bytes, ${check.timeMs}ms)`);
        saveLocalCatalog(verifiedList);
      } else {
        console.log(`[Auditor] ❌ Rejected: ${v.url.slice(21, 60)} (${check.reason})`);
      }
    }
  }

  saveLocalCatalog(verifiedList);
  console.log(`[Auditor] Audit complete. Total verified working videos: ${verifiedList.length}`);
  return verifiedList;
}

function getVerifiedBrowse(page = 1, limit = 20) {
  const catalog = getLocalCatalog();
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
    videos: slice.map((v, idx) => ({
      ...v,
      title: `Video ${start + idx + 1} (Page ${page})`
    }))
  };
}

module.exports = {
  verifyVideo,
  auditAndPopulateCatalog,
  getVerifiedBrowse,
  getLocalCatalog,
  saveLocalCatalog
};
