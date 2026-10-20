const https = require('https');

// ==========================================
// In-Memory Cache (Sub-millisecond responses for 10k users)
// ==========================================
const cache = new Map();

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }
  return item.data;
}

function setCached(key, data, ttlSeconds = 600) {
  if (cache.size > 10000) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, {
    data,
    expiresAt: Date.now() + (ttlSeconds * 1000)
  });
}

// ==========================================
// Lightweight HTTP Engine (Zero external dependencies)
// ==========================================
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function httpGet(url, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = https.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      rejectUnauthorized: false,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        ...headers
      }
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let redirectUrl = res.headers.location;
        if (!redirectUrl.startsWith('http')) {
          redirectUrl = new URL(redirectUrl, url).toString();
        }
        return resolve(httpGet(redirectUrl, headers, timeoutMs));
      }

      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }

      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout (${timeoutMs}ms) for ${url}`));
    });
  });
}

function httpPost(url, data, headers = {}, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const contentType = headers['Content-Type'] || 'application/x-www-form-urlencoded';
    const isJson = contentType.includes('json');
    const payload = typeof data === 'string' ? data : (isJson ? JSON.stringify(data) : new URLSearchParams(data).toString());

    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      rejectUnauthorized: false,
      headers: {
        'User-Agent': USER_AGENT,
        'Origin': 'https://playmate.to',
        'Referer': 'https://playmate.to/',
        ...headers,
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`POST timeout (${timeoutMs}ms) for ${url}`));
    });

    req.write(payload);
    req.end();
  });
}

// ==========================================
// Regex-Based Video List Parser
// Zero DOM overhead, instant execution
// ==========================================
function parsePagination(html, requestedPage = 1) {
  let currentPage = Number(requestedPage) || 1;
  let totalPages = currentPage;
  let hasNext = false;
  let hasPrev = currentPage > 1;

  const pagMatch = html.match(/<div\b[^>]*class="[^"]*pagination[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (pagMatch) {
    const pagHtml = pagMatch[1];
    const curMatch = pagHtml.match(/<a\b[^>]*class="[^"]*current[^"]*"[^>]*>(\d+)<\/a>/i);
    if (curMatch) currentPage = parseInt(curMatch[1], 10);

    const lastMatch = pagHtml.match(/href="[^"]*\/page\/(\d+)\/?"[^>]*>Last<\/a>/i) ||
                      pagHtml.match(/>Last<\/a>[\s\S]*?href="[^"]*\/page\/(\d+)\/?"/i);
    if (lastMatch) {
      totalPages = parseInt(lastMatch[1], 10);
    } else {
      const allNums = [...pagHtml.matchAll(/\/page\/(\d+)\//g)].map(m => parseInt(m[1], 10));
      if (allNums.length > 0) totalPages = Math.max(...allNums, currentPage);
    }

    if (/>Next<\/a>/i.test(pagHtml) || totalPages > currentPage) hasNext = true;
    if (/>(?:Previous|Prev)<\/a>/i.test(pagHtml) || currentPage > 1) hasPrev = true;
  }

  return {
    currentPage,
    totalPages: Math.max(totalPages, currentPage),
    hasNextPage: hasNext,
    hasPrevPage: hasPrev
  };
}

function parseVideoList(html, requestedPage = 1) {
  const videos = [];
  const articleRegex = /<article\b[^>]*class="[^"]*thumb-block[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let articleMatch;

  while ((articleMatch = articleRegex.exec(html)) !== null) {
    const block = articleMatch[1];

    const linkMatch = block.match(/<a\b[^>]*href="(https:\/\/desi52\.watch\/[^"]+\/)"[^>]*title="([^"]+)"/i) ||
                      block.match(/<a\b[^>]*title="([^"]+)"[^>]*href="(https:\/\/desi52\.watch\/[^"]+\/)"/i);
    
    if (!linkMatch) continue;

    const url = linkMatch[1].startsWith('http') ? linkMatch[1] : linkMatch[2];
    const videoIndex = videos.length + 1;
    const title = `Video ${videoIndex} (Page ${requestedPage})`;

    const thumbMatch = block.match(/data-main-thumb="([^"]+)"/i) ||
                       block.match(/<img\b[^>]*src="([^"]+)"/i) ||
                       block.match(/data-src="([^"]+)"/i);
    const rawThumb = thumbMatch ? thumbMatch[1] : '';
    const thumb = rawThumb ? `/api/thumb?url=${encodeURIComponent(rawThumb)}` : '';

    const durMatch = block.match(/<span\b[^>]*class="[^"]*duration[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const duration = durMatch ? durMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const viewsMatch = block.match(/<span\b[^>]*class="[^"]*views[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    const views = viewsMatch ? viewsMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const isHD = /class="[^"]*hd-video[^"]*"/i.test(block);

    const slugMatch = url.match(/desi52\.watch\/([^\/]+)\/?/);
    const id = slugMatch ? slugMatch[1] : Buffer.from(url).toString('base64').slice(0, 12);

    videos.push({
      id,
      title,
      url,
      thumb,
      duration,
      views,
      isHD
    });
  }

  const pagination = parsePagination(html, requestedPage);
  return { videos, ...pagination };
}

// ==========================================
// Dead & Unplayable Video Blacklist
// ==========================================
const deadUrlsSet = new Set([
  'https://desi52.watch/village-tamil-hard-sex-married-naked-mms/',
  'https://desi52.watch/neighbor-spies-sex-and-aunty-his-friends-viralsex-videos/',
  'https://desi52.watch/hot-shy-bhabhi-fuck-secret-devar-sex/',
  'https://desi52.watch/district-court-judge-aunty-neighbour-rc-video-virl-video-xx/',
  'https://desi52.watch/sexy-indian-gf-hard-fucking-leaked-desi-cute-girls-videos/',
  'https://desi52.watch/mature-aunty-affair-husbend-long-distance-neighbourxx-viral/',
  'https://desi52.watch/horny-gf-pressing-boobs-and-sex-by-bf-leaked-desi-mms-porn/'
]);

function markDeadVideo(url) {
  if (!url) return;
  deadUrlsSet.add(url);
  setCached(`status:${url}`, false, 86400 * 7);
}

function filterPlayableVideos(rawVideos, requestedPage = 1) {
  if (!rawVideos || rawVideos.length === 0) return [];

  const candidates = rawVideos.filter(v => !deadUrlsSet.has(v.url));
  return candidates.map((v, idx) => ({
    ...v,
    title: `Video ${idx + 1} (Page ${requestedPage})`
  }));
}

// ==========================================
// Public APIs
// ==========================================

async function getBrowseVideos(page = 1, filter = 'latest') {
  const cacheKey = `browse:v5:${filter}:${page}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let url = 'https://desi52.watch/';
  if (page > 1) {
    url += `page/${page}/`;
  }
  if (filter && filter !== 'latest') {
    url += `?filter=${encodeURIComponent(filter)}`;
  }

  try {
    const html = await httpGet(url);
    const result = parseVideoList(html, page);
    const cleanVideos = filterPlayableVideos(result.videos, page);
    const response = {
      ok: true,
      page: Number(page),
      filter,
      ...result,
      videos: cleanVideos
    };
    setCached(cacheKey, response, 300);
    return response;
  } catch (err) {
    console.error(`[Scraper] Browse error (${url}):`, err.message);
    const stale = getCached(cacheKey);
    if (stale) return stale;
    return { ok: false, error: err.message, videos: [], hasNextPage: false };
  }
}

async function getCategoryVideos(slug, page = 1) {
  const cacheKey = `cat:v4:${slug}:${page}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let url = `https://desi52.watch/category/${encodeURIComponent(slug)}/`;
  if (page > 1) {
    url += `page/${page}/`;
  }

  try {
    const html = await httpGet(url);
    const result = parseVideoList(html, page);
    const cleanVideos = filterPlayableVideos(result.videos, page);
    const response = {
      ok: true,
      category: slug,
      page: Number(page),
      ...result,
      videos: cleanVideos
    };
    setCached(cacheKey, response, 300);
    return response;
  } catch (err) {
    console.error(`[Scraper] Category error (${url}):`, err.message);
    const stale = getCached(cacheKey);
    if (stale) return stale;
    return { ok: false, error: err.message, videos: [], hasNextPage: false };
  }
}

async function searchVideos(query, page = 1) {
  const cacheKey = `search:v4:${query.toLowerCase()}:${page}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  let url = 'https://desi52.watch/';
  if (page > 1) {
    url += `page/${page}/`;
  }
  url += `?s=${encodeURIComponent(query)}`;

  try {
    const html = await httpGet(url);
    const result = parseVideoList(html, page);
    const cleanVideos = filterPlayableVideos(result.videos, page);
    const response = {
      ok: true,
      query,
      page: Number(page),
      ...result,
      videos: cleanVideos
    };
    setCached(cacheKey, response, 300);
    return response;
  } catch (err) {
    console.error(`[Scraper] Search error (${url}):`, err.message);
    const stale = getCached(cacheKey);
    if (stale) return stale;
    return { ok: false, error: err.message, videos: [], hasNextPage: false };
  }
}

function toBase(c, a) {
  if (a <= 36) return c.toString(a);
  const chars = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let res = '';
  do {
    res = chars[c % a] + res;
    c = Math.floor(c / a);
  } while (c > 0);
  return res || '0';
}

function unpackDeanEdwards(html) {
  const match = html.match(/}\('([\s\S]*?)',\s*(\d+),\s*(\d+),\s*'([\s\S]*?)'\.split\('\|'\)/);
  if (!match) return null;

  let [_, p, a, c, kStr] = match;
  a = parseInt(a, 10);
  c = parseInt(c, 10);
  const k = kStr.split('|');

  while (c--) {
    if (k[c]) {
      const regex = new RegExp('\\b' + toBase(c, a) + '\\b', 'g');
      p = p.replace(regex, k[c]);
    }
  }
  return p;
}

async function resolveLuluEmbed(embedUrl) {
  try {
    const cleanUrl = embedUrl.replace('luluvdo.com', 'luluvido.com');
    const host = new URL(cleanUrl).hostname;
    const html = await httpGet(cleanUrl, {
      'Referer': 'https://desi52.watch/'
    }, 6000);

    const unpacked = unpackDeanEdwards(html);
    if (!unpacked) return null;

    const m3u8Match = unpacked.match(/https?:\/\/[^\s"']+\.m3u8[^\s"']*/);
    if (!m3u8Match) return null;

    const posterMatch = unpacked.match(/image:\s*["']([^"']+)["']/i);

    return {
      sx: m3u8Match[0],
      ix: posterMatch ? posterMatch[1] : null,
      ref: `https://${host}/`
    };
  } catch (e) {
    return null;
  }
}

let lastPlaymateReq = 0;
async function fetchPlaymateWithThrottle(filecode, refererType = 'embed') {
  const now = Date.now();
  const diff = now - lastPlaymateReq;
  if (diff < 200) {
    await new Promise(r => setTimeout(r, 200 - diff));
  }
  lastPlaymateReq = Date.now();

  try {
    const apiResText = await httpPost('https://playmate.to/api/s', {
      c: filecode,
      d: 'desktop'
    }, {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'Origin': 'https://playmate.to',
      'Referer': `https://playmate.to/${refererType}/${filecode}`,
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin'
    });
    return JSON.parse(apiResText);
  } catch (err) {
    return null;
  }
}

/**
 * Direct Stream Resolver (Bypasses Ads, Turnstiles & Popups)
 * ONLY allows pure high-speed direct HLS streams (Playmate & LuluStream).
 */
async function getDirectStream(videoPageUrl) {
  const cacheKey = `stream:v13:${videoPageUrl}`;
  const cached = getCached(cacheKey);
  if (cached && cached.type === 'hls') return cached;

  try {
    const html = await httpGet(videoPageUrl);
    const title = 'Now Playing';

    // Extract poster image
    const posterMatch = html.match(/<meta property="og:image" content="([^"]+)"/i) ||
                        html.match(/<link rel="image_src" href="([^"]+)"/i);
    const poster = posterMatch ? posterMatch[1] : '';

    // Step 1: Detect primary iframe in player container
    const iframeMatches = [...html.matchAll(/<iframe\b[^>]*src=["']([^"']+)["']/gi)].map(m => m[1]);
    
    // Step 1: Detect Playmate iframe in player container (Strictly fast direct-CORS)
    for (const ifr of iframeMatches) {
      const pmMatch = ifr.match(/playmate\.to\/(?:embed|watch)\/([a-zA-Z0-9]+)/i);
      if (pmMatch) {
        const filecode = pmMatch[1];
        let apiData = await fetchPlaymateWithThrottle(filecode, 'embed');
        if (!apiData || !apiData.sx) {
          await new Promise(r => setTimeout(r, 150));
          apiData = await fetchPlaymateWithThrottle(filecode, 'watch');
        }
        if (apiData && apiData.sx) {
          const streamResult = {
            ok: true,
            type: 'hls',
            streamUrl: `/api/live.m3u8?url=${encodeURIComponent(apiData.sx)}`,
            rawUrl: apiData.sx,
            poster: apiData.ix || poster,
            title
          };
          setCached(cacheKey, streamResult, 3600);
          return streamResult;
        }
      }
    }

    // Step 2: Fallback - Scan entire page HTML for Playmate links
    const pmMatches = [...html.matchAll(/playmate\.to\/(?:embed|watch)\/([a-zA-Z0-9]+)/gi)];
    const filecodes = [...new Set(pmMatches.map(m => m[1]))];

    for (const filecode of filecodes) {
      let apiData = await fetchPlaymateWithThrottle(filecode, 'embed');
      if (!apiData || !apiData.sx) {
        await new Promise(r => setTimeout(r, 150));
        apiData = await fetchPlaymateWithThrottle(filecode, 'watch');
      }

      if (apiData && apiData.sx) {
        const streamResult = {
          ok: true,
          type: 'hls',
          streamUrl: `/api/live.m3u8?url=${encodeURIComponent(apiData.sx)}`,
          rawUrl: apiData.sx,
          poster: apiData.ix || poster,
          title
        };
        setCached(cacheKey, streamResult, 3600);
        return streamResult;
      }
    }

    // Mark as dead / unavailable so it is pruned from listings
    markDeadVideo(videoPageUrl);
    return {
      ok: false,
      error: 'Video is unavailable on high-speed CDN.',
      poster,
      title
    };
  } catch (err) {
    console.error(`[Scraper] Stream extract error (${videoPageUrl}):`, err.message);
    return { ok: false, error: 'Connection hiccup. Please tap retry.' };
  }
}

const CATEGORIES = [
  { name: '🔥 Latest Videos', slug: '' },
  { name: 'Desi Cute Girls', slug: 'desi-cute-girls-videos' },
  { name: 'Indian Desi MMS', slug: 'indian-desi-mms' },
  { name: '18+ Web Series', slug: '18-web-series' },
  { name: 'Bangla Clips', slug: 'bangla-sex-videos' },
  { name: 'Arab Clips', slug: 'arab-sex-videos' }
];

module.exports = {
  getBrowseVideos,
  getCategoryVideos,
  searchVideos,
  getDirectStream,
  markDeadVideo,
  httpGet,
  USER_AGENT,
  CATEGORIES
};
