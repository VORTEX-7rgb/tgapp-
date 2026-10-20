/**
 * upskirt_scraper.js - Production scraper & API resolver for upskirt.tv
 * 
 * Features:
 * - Pure Node.js DPI bypass (fragments TLS ClientHello at byte 30 to bypass campus & ISP middlebox firewalls)
 * - Cloudflare edge IP failover
 * - Instant chunk-aware HTTP response detection
 * - Direct JSON stream resolution via POST api.upskirt.tv/hls (1080p/480p MP4 + HLS master)
 * - 0.00 KB VPS Bandwidth: All video streams and thumbnails play direct from CDN
 */

const net = require('net');
const tls = require('tls');
const { Transform, Duplex } = require('stream');

const HOST = 'upskirt.tv';
const API_HOST = 'api.upskirt.tv';

// Cloudflare IPs for upskirt.tv
const CLOUDFLARE_IPS = ['104.26.10.10', '104.26.11.10', '172.67.69.17'];
// Edge IP for api.upskirt.tv
const API_IPS = ['45.84.31.172'];

// Pure Node.js DPI Splitter: Fragments TLS ClientHello at byte 30
class DpiSplitter extends Transform {
  constructor() {
    super();
    this.first = true;
  }
  _transform(chunk, enc, cb) {
    if (this.first && chunk.length > 30) {
      this.first = false;
      this.push(chunk.slice(0, 30));
      setTimeout(() => {
        this.push(chunk.slice(30));
        cb();
      }, 40);
    } else {
      this.push(chunk);
      cb();
    }
  }
}

/**
 * Performs a DPI-bypassed HTTP GET request to upskirt.tv
 */
function fetchUpskirt(path = '/latest', maxRetries = 3) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const doRequest = () => {
      attempt++;
      let rawSocket = null;
      let tlsSocket = null;
      let resolved = false;

      const ip = CLOUDFLARE_IPS[(attempt - 1) % CLOUDFLARE_IPS.length];

      const cleanup = () => {
        try { if (tlsSocket) tlsSocket.destroy(); } catch (e) {}
        try { if (rawSocket) rawSocket.destroy(); } catch (e) {}
      };

      const retryOrReject = (err) => {
        cleanup();
        if (resolved) return;
        resolved = true;
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 200 + Math.random() * 200;
          setTimeout(doRequest, delay);
        } else {
          reject(err);
        }
      };

      const timer = setTimeout(() => {
        retryOrReject(new Error(`Fetch timeout on ${path}`));
      }, 15000);

      try {
        rawSocket = net.connect(443, ip, () => {
          const splitter = new DpiSplitter();
          splitter.pipe(rawSocket);

          const duplex = new Duplex({
            read() {},
            write(chunk, enc, cb) { splitter.write(chunk, enc, cb); }
          });
          rawSocket.on('data', c => duplex.push(c));
          rawSocket.on('end', () => duplex.push(null));

          tlsSocket = tls.connect({
            socket: duplex,
            servername: HOST,
            rejectUnauthorized: false
          }, () => {
            const req = `GET ${path} HTTP/1.1\r\n` +
              `Host: ${HOST}\r\n` +
              `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36\r\n` +
              `Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8\r\n` +
              `Accept-Language: en-US,en;q=0.9\r\n` +
              `Connection: close\r\n\r\n`;
            tlsSocket.write(req);
          });

          const chunks = [];
          let totalLen = 0;
          let headerEnd = -1;
          let expectedLen = -1;
          let isChunked = false;

          tlsSocket.on('data', c => {
            chunks.push(c);
            totalLen += c.length;
            const buffer = Buffer.concat(chunks, totalLen);

            if (headerEnd === -1) {
              const idx = buffer.indexOf('\r\n\r\n');
              if (idx !== -1) {
                headerEnd = idx + 4;
                const headersStr = buffer.slice(0, idx).toString('utf-8');
                const clMatch = headersStr.match(/content-length:\s*(\d+)/i);
                if (clMatch) expectedLen = headerEnd + parseInt(clMatch[1], 10);
                if (/transfer-encoding:\s*chunked/i.test(headersStr)) isChunked = true;
              }
            }

            if (expectedLen !== -1 && totalLen >= expectedLen) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                cleanup();
                resolve(buffer.toString('utf-8'));
              }
            } else if (isChunked && buffer.slice(-5).toString().includes('0\r\n\r\n')) {
              if (!resolved) {
                resolved = true;
                clearTimeout(timer);
                cleanup();
                resolve(buffer.toString('utf-8'));
              }
            }
          });

          tlsSocket.on('end', () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              cleanup();
              resolve(Buffer.concat(chunks).toString('utf-8'));
            }
          });

          tlsSocket.on('error', retryOrReject);
        });

        rawSocket.on('error', retryOrReject);
      } catch (err) {
        retryOrReject(err);
      }
    };

    doRequest();
  });
}

/**
 * Calls api.upskirt.tv/hls with DPI bypass to resolve master HLS and direct MP4 streams
 */
function callUpskirtApi(numericId, maxRetries = 3) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const doRequest = () => {
      attempt++;
      let rawSocket = null;
      let tlsSocket = null;
      let resolved = false;

      const ip = API_IPS[(attempt - 1) % API_IPS.length];
      const postData = `id=${numericId}`;

      const cleanup = () => {
        try { if (tlsSocket) tlsSocket.destroy(); } catch (e) {}
        try { if (rawSocket) rawSocket.destroy(); } catch (e) {}
      };

      const retryOrReject = (err) => {
        cleanup();
        if (resolved) return;
        resolved = true;
        if (attempt < maxRetries) {
          setTimeout(doRequest, 400);
        } else {
          reject(err);
        }
      };

      const timer = setTimeout(() => {
        retryOrReject(new Error(`API timeout for ID ${numericId}`));
      }, 10000);

      try {
        rawSocket = net.connect(443, ip, () => {
          const splitter = new DpiSplitter();
          splitter.pipe(rawSocket);

          const duplex = new Duplex({
            read() {},
            write(chunk, enc, cb) { splitter.write(chunk, enc, cb); }
          });
          rawSocket.on('data', c => duplex.push(c));
          rawSocket.on('end', () => duplex.push(null));

          tlsSocket = tls.connect({
            socket: duplex,
            servername: API_HOST,
            rejectUnauthorized: false
          }, () => {
            const req = `POST /hls HTTP/1.1\r\n` +
              `Host: ${API_HOST}\r\n` +
              `Origin: https://${HOST}\r\n` +
              `Referer: https://${HOST}/\r\n` +
              `Content-Type: application/x-www-form-urlencoded; charset=UTF-8\r\n` +
              `Content-Length: ${Buffer.byteLength(postData)}\r\n` +
              `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36\r\n` +
              `Connection: close\r\n\r\n` +
              postData;
            tlsSocket.write(req);
          });

          const chunks = [];
          tlsSocket.on('data', c => chunks.push(c));
          tlsSocket.on('end', () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              cleanup();
              const fullResponse = Buffer.concat(chunks).toString('utf-8');
              const bodyIdx = fullResponse.indexOf('\r\n\r\n');
              const body = bodyIdx !== -1 ? fullResponse.substring(bodyIdx + 4) : fullResponse;
              try {
                const parsed = JSON.parse(body);
                resolve(parsed);
              } catch (e) {
                reject(new Error(`Invalid JSON from API: ${body.substring(0, 100)}`));
              }
            }
          });

          tlsSocket.on('error', retryOrReject);
        });

        rawSocket.on('error', retryOrReject);
      } catch (err) {
        retryOrReject(err);
      }
    };

    doRequest();
  });
}

/**
 * Parses video cards from an upskirt.tv listing page HTML
 */
function parseListing(html) {
  const videos = [];
  const articleRegex = /<article\s+class="thumb item"\s+data-gid="(\d+)">([\s\S]*?)<\/article>/gi;
  let match;

  while ((match = articleRegex.exec(html)) !== null) {
    const numericId = match[1];
    const cardHtml = match[2];

    // Extract link & slug
    const linkMatch = cardHtml.match(/href="\/play\/(\d+)\/([^"]+)"/i);
    const slug = linkMatch ? linkMatch[2] : '';

    // Extract title
    const titleMatch = cardHtml.match(/title="([^"]+)"/i) || cardHtml.match(/class="thumb-title">([^<]+)<\/div>/i);
    const title = titleMatch ? titleMatch[1].trim() : `Video #${numericId}`;

    // Extract thumbnail
    const imgMatch = cardHtml.match(/<img[^>]+src="([^"]+)"/i);
    let thumb = imgMatch ? imgMatch[1].replace(/&amp;/g, '&') : '';
    if (!thumb) {
      const srcsetMatch = cardHtml.match(/srcset="([^"\s]+)/i);
      if (srcsetMatch) thumb = srcsetMatch[1].replace(/&amp;/g, '&');
    }

    // Extract hover video preview
    const previewMatch = cardHtml.match(/data-preview="([^"]+)"/i);
    const preview = previewMatch ? previewMatch[1] : '';

    // Extract duration
    const timeMatch = cardHtml.match(/class="itemw time">\s*([^<\s]+)\s*<\/div>/i);
    const duration = timeMatch ? timeMatch[1].trim() : '';

    // Extract rating / views
    const countMatch = cardHtml.match(/<div class="count-inner">\s*<span>([^<]+)<\/span>/i);
    const stats = countMatch ? countMatch[1].trim() : '';

    videos.push({
      id: `ut-${numericId}`,
      numericId,
      slug,
      title,
      thumb,
      preview,
      duration,
      stats,
      source: 'upskirt',
      url: `/play/${numericId}/${slug}`
    });
  }

  // Check pagination info
  let totalPages = 1;
  const pageMatches = html.match(/\/latest\/(\d+)/g) || html.match(/\/page\/(\d+)/g);
  if (pageMatches) {
    pageMatches.forEach(p => {
      const num = parseInt(p.match(/\d+/)[0], 10);
      if (num > totalPages && num < 200) totalPages = num;
    });
  }

  return {
    ok: true,
    videos,
    total: videos.length,
    totalPages
  };
}

/**
 * Resolves full video stream links via the official API
 */
async function resolveVideo(numericId) {
  try {
    const apiRes = await callUpskirtApi(numericId);
    if (!apiRes) return null;

    let streamUrl = '';
    let mp4_1080 = '';
    let mp4_480 = '';

    if (Array.isArray(apiRes.mp4)) {
      const v1080 = apiRes.mp4.find(m => m.title && m.title.includes('1080'));
      const v720 = apiRes.mp4.find(m => m.title && m.title.includes('720'));
      const v480 = apiRes.mp4.find(m => m.title && m.title.includes('480'));
      if (v1080 && v1080.src) mp4_1080 = v1080.src;
      if (v480 && v480.src) mp4_480 = v480.src;
      // Default to 1080p, then 720p, then 480p, fallback to first item
      streamUrl = (v1080 && v1080.src) || (v720 && v720.src) || (v480 && v480.src) || (apiRes.mp4[0] ? apiRes.mp4[0].src : '');
    }

    const master = apiRes.master || '';
    if (!streamUrl && master) {
      streamUrl = master;
    }

    // Extract token timestamp
    let expiresAt = Math.floor(Date.now() / 1000) + 7200; // default 2h
    if (streamUrl) {
      const timeMatch = streamUrl.match(/,(\d+)\//);
      if (timeMatch) {
        expiresAt = parseInt(timeMatch[1], 10);
      }
    }

    return {
      ok: true,
      id: `ut-${numericId}`,
      numericId,
      streamUrl,
      mp4_1080,
      mp4_480,
      master,
      mp4List: apiRes.mp4 || [],
      hlsList: apiRes.links || [],
      expiresAt,
      verifiedAt: Date.now()
    };
  } catch (err) {
    console.error(`[Upskirt Scraper] Resolve error for ID ${numericId}:`, err.message);
    return null;
  }
}

/**
 * Scrapes a listing page from upskirt.tv
 */
async function getListingPage(page = 1, category = '') {
  let path = '/latest';
  if (category && category !== 'all' && category !== 'latest') {
    path = page > 1 ? `/tags/${category}/${page}` : `/tags/${category}`;
  } else {
    path = page > 1 ? `/latest/${page}` : '/latest';
  }
  const html = await fetchUpskirt(path);
  return parseListing(html);
}

module.exports = {
  fetchUpskirt,
  callUpskirtApi,
  parseListing,
  resolveVideo,
  getListingPage
};
