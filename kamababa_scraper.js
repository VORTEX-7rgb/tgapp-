const https = require('https');
const http = require('http');
const { URL } = require('url');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const CATEGORIES = [
  { name: 'Latest / All', slug: 'all' },
  { name: 'Desi', slug: 'desi' },
  { name: 'Aunty', slug: 'aunty' },
  { name: 'Blowjob', slug: 'blowjob' },
  { name: 'Hindi Sexy', slug: 'hindi-sexy-videos' },
  { name: 'Bangla Sex', slug: 'bangla-sex' },
  { name: 'Pakistani Sex', slug: 'pakistani-sex' },
  { name: 'Indian', slug: 'indian' },
  { name: 'Maid', slug: 'maid' },
  { name: 'Anal', slug: 'anal' },
  { name: 'Group Sex', slug: 'groupsex' },
  { name: 'Hardcore', slug: 'hardcore' },
  { name: 'Desi Hidden Sex', slug: 'desi-hidden-sex' },
  { name: 'Bathroom', slug: 'bathroom' },
  { name: 'Actress', slug: 'actress' },
  { name: 'Lesbian', slug: 'lesbian' }
];

/**
 * Wraps thumbnail URLs through our resilient in-memory /api/thumb proxy:
 * - Bypasses third-party policy bans (like wsrv.nl blocking adult domains)
 * - Bypasses Indian ISP DNS blocks (Jio/Airtel) on www.mykamababa.com
 * - Caches images in RAM with 7-day browser Cache-Control
 */
function proxyThumbnail(url) {
  if (!url) return '';
  if (url.startsWith('/api/thumb')) return url;
  return `/api/thumb?url=${encodeURIComponent(url)}`;
}

/**
 * Resilient HTTP GET client with timeout, redirect following, and retry logic
 */
function httpGet(targetUrl, headers = {}, timeoutMs = 9000, maxRetries = 2) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    function execute(url) {
      attempt++;
      try {
        const parsed = new URL(url);
        const transport = parsed.protocol === 'https:' ? https : http;

        const reqOptions = {
          protocol: parsed.protocol,
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
          path: parsed.pathname + parsed.search,
          method: 'GET',
          headers: {
            'User-Agent': USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache',
            ...headers
          },
          timeout: timeoutMs
        };

        const req = transport.request(reqOptions, (res) => {
          // Handle HTTP redirects (301, 302, 307, 308)
          if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
            const redirectUrl = new URL(res.headers.location, url).toString();
            res.resume();
            return execute(redirectUrl);
          }

          if (res.statusCode >= 400) {
            res.resume();
            if (attempt <= maxRetries && [429, 500, 502, 503, 504].includes(res.statusCode)) {
              return setTimeout(() => execute(url), attempt * 1000);
            }
            return reject(new Error(`HTTP ${res.statusCode} from ${parsed.hostname}`));
          }

          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => resolve(data));
        });

        req.on('timeout', () => {
          req.destroy(new Error(`Request timed out after ${timeoutMs}ms`));
        });

        req.on('error', (err) => {
          if (attempt <= maxRetries) {
            return setTimeout(() => execute(url), attempt * 1000);
          }
          reject(err);
        });

        req.end();
      } catch (err) {
        reject(err);
      }
    }

    execute(targetUrl);
  });
}

/**
 * 3-Tier Scraper Fallback for extracting direct .mp4 and metadata from a post
 * Tier 1: Base64 + URL decode of clean-tube-player/public/player-x.php?q=...
 * Tier 2: Direct regex for https://cdn.mykamababa.com/...mp4 in raw post HTML
 * Tier 3: Meta tags (<meta itemprop="contentURL">, og:video) and HTML5 video tags
 */
async function extractVideoFromPost(postUrl, cachedHtml = null) {
  try {
    const html = cachedHtml || await httpGet(postUrl);

    // 1. Extract Post ID or Slug
    let id = '';
    const idMatch = html.match(/postid-(\d+)/i) || html.match(/data-post-id=["'](\d+)["']/i);
    if (idMatch) {
      id = `kmb-${idMatch[1]}`;
    } else {
      const slugMatch = postUrl.replace(/\/$/, '').split('/').pop();
      id = `kmb-${slugMatch || Math.random().toString(36).substring(7)}`;
    }

    // 2. Extract Title
    let title = '';
    const titleMatch = html.match(/<h1[^>]*class=["'][^"']*entry-title[^"']*["'][^>]*>(.*?)<\/h1>/i) ||
                       html.match(/<h1[^>]*>(.*?)<\/h1>/i) ||
                       html.match(/<title>(.*?)<\/title>/i);
    if (titleMatch) {
      title = titleMatch[1].replace(/<[^>]+>/g, '').replace(/&#8217;/g, "'").replace(/&#8211;/g, "-").replace(/\s*-\s*MyKamaBaba/i, '').trim();
    } else {
      title = 'Video ' + id;
    }

    // 3. Extract Poster Image
    let rawPoster = '';
    const posterMatch = html.match(/poster=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp))["']/i) ||
                        html.match(/property=["']og:image["']\s+content=["'](https?:\/\/[^"']+)["']/i) ||
                        html.match(/<meta\s+itemprop=["']thumbnailUrl["']\s+content=["'](https?:\/\/[^"']+)["']/i);
    if (posterMatch) {
      rawPoster = posterMatch[1];
    }

    // 4. Extract Direct Video Stream URL (3-Tier Fallback)
    let streamUrl = null;
    let extractionTier = 0;

    // --- TIER 1: Clean Tube Player Base64 Query String ---
    const qMatch = html.match(/clean-tube-player\/public\/player-x\.php\?q=([A-Za-z0-9+/=]+)/i);
    if (qMatch) {
      try {
        const decodedB64 = Buffer.from(qMatch[1], 'base64').toString('utf8');
        const unquoted = decodeURIComponent(decodedB64);
        const srcMatch = unquoted.match(/src=["'](https?:\/\/[^"']+\.mp4)["']/i) ||
                         unquoted.match(/src%3D%22([^%]+\.mp4)%22/i);
        if (srcMatch) {
          streamUrl = decodeURIComponent(srcMatch[1]);
          extractionTier = 1;
        }

        if (!rawPoster) {
          const posterInQ = unquoted.match(/poster=["'](https?:\/\/[^"']+\.(?:jpg|jpeg|png|webp))["']/i);
          if (posterInQ) rawPoster = decodeURIComponent(posterInQ[1]);
        }
      } catch (e) {
        // Fall through to Tier 2
      }
    }

    // --- TIER 2: Direct Regex on Raw HTML for cdn.mykamababa.com MP4 ---
    if (!streamUrl) {
      const cdnMatch = html.match(/(https:\/\/cdn\.mykamababa\.com\/\d{4}\/\d{2}\/[^"'\s<>]+\.mp4)/i);
      if (cdnMatch) {
        streamUrl = cdnMatch[1];
        extractionTier = 2;
      }
    }

    // --- TIER 3: Meta Tag Fallbacks (<meta itemprop="contentURL">, og:video, <source>) ---
    if (!streamUrl) {
      const metaMatch = html.match(/<meta[^>]+itemprop=["']contentURL["'][^>]+content=["'](https?:\/\/[^"']+\.mp4)["']/i) ||
                        html.match(/<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["'](https?:\/\/[^"']+\.mp4)["']/i) ||
                        html.match(/<source[^>]+src=["'](https?:\/\/[^"']+\.mp4)["']/i);
      if (metaMatch) {
        streamUrl = metaMatch[1];
        extractionTier = 3;
      }
    }

    if (!streamUrl) {
      return { ok: false, error: 'No MP4 stream found across all 3 tiers', postUrl };
    }

    // Ensure valid HTTPS stream URL
    if (streamUrl.startsWith('http://')) {
      streamUrl = streamUrl.replace('http://', 'https://');
    }

    // 5. Extract Category if present
    let category = 'desi';
    const catMatch = html.match(/\/category\/([a-z0-9\-]+)\//i);
    if (catMatch && catMatch[1]) {
      category = catMatch[1];
    }

    // Generate ISP-proof thumbnail
    const thumb = proxyThumbnail(rawPoster);

    return {
      ok: true,
      id,
      title,
      slug: postUrl.replace(/\/$/, '').split('/').pop(),
      postUrl,
      streamUrl,
      poster: rawPoster,
      thumb,
      category,
      type: 'mp4',
      tier: extractionTier,
      verifiedAt: Date.now()
    };
  } catch (err) {
    return { ok: false, error: err.message, postUrl };
  }
}

/**
 * Harvests video post items from a listing or category page
 */
async function getPostsFromListingPage(pageUrl) {
  try {
    const html = await httpGet(pageUrl);

    // Look for article links with titles
    const regex = /<a[^>]+href=["'](https:\/\/www\.mykamababa\.com\/[^"\'?#]+\/)["'][^>]*title=["']([^"']+)["'][^>]*>/gi;
    let match;
    const items = [];
    const seen = new Set();

    while ((match = regex.exec(html)) !== null) {
      const postUrl = match[1];
      const titleRaw = match[2];

      // Exclude static navigation and taxonomy pages
      if (
        postUrl.includes('/category/') ||
        postUrl.includes('/categories/') ||
        postUrl.includes('/tags/') ||
        postUrl.includes('/tag/') ||
        postUrl.includes('/content-complaint/') ||
        postUrl.includes('/contact-us/') ||
        postUrl.includes('/unblock-kamababa-website/') ||
        postUrl.includes('/author/') ||
        postUrl.includes('/page/')
      ) {
        continue;
      }

      if (!seen.has(postUrl)) {
        seen.add(postUrl);
        const cleanTitle = titleRaw
          .replace(/&#8217;/g, "'")
          .replace(/&#8211;/g, "-")
          .replace(/\s*-\s*MyKamaBaba/i, '')
          .trim();

        items.push({
          postUrl,
          title: cleanTitle
        });
      }
    }

    // Extract total pages if visible
    let totalPages = 1;
    const pageMatches = html.match(/\/page\/(\d+)\//g);
    if (pageMatches) {
      const nums = pageMatches.map(m => {
        const num = m.match(/\d+/);
        return num ? parseInt(num[0], 10) : 1;
      });
      totalPages = Math.max(...nums, 1);
    }

    return { ok: true, items, totalPages };
  } catch (err) {
    return { ok: false, error: err.message, items: [], totalPages: 1 };
  }
}

module.exports = {
  USER_AGENT,
  CATEGORIES,
  proxyThumbnail,
  httpGet,
  extractVideoFromPost,
  getPostsFromListingPage
};
