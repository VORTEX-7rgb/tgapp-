const net = require('net');
const tls = require('tls');
const { Transform, Duplex } = require('stream');

const HOST = 'www.cumlouder.com';
const CLOUDFLARE_IPS = ['104.21.48.241'];

// Pure Node.js DPI Splitter: Fragments TLS ClientHello at byte 30 to bypass campus & network DPI firewalls
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
 * High-performance fetch from cumlouder.com with DPI bypass, Cloudflare IP failover,
 * and immediate Content-Length / Chunked HTTP completion detection (sub-second responses).
 */
function fetchCumlouder(path = '/porn/', maxRetries = 3) {
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
          const delay = Math.pow(2, attempt) * 300 + Math.random() * 200;
          setTimeout(doRequest, delay);
        } else {
          reject(err);
        }
      };

      try {
        rawSocket = net.connect(443, ip, () => {
          const splitter = new DpiSplitter();
          splitter.pipe(rawSocket);

          const duplex = new Duplex({
            read() {},
            write(chunk, enc, cb) {
              splitter.write(chunk, enc, cb);
            }
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
                if (clMatch) {
                  expectedLen = headerEnd + parseInt(clMatch[1], 10);
                }
                if (/transfer-encoding:\s*chunked/i.test(headersStr)) {
                  isChunked = true;
                }
              }
            }

            // Early exit as soon as full payload is received
            if (expectedLen !== -1 && totalLen >= expectedLen) {
              if (!resolved) {
                resolved = true;
                cleanup();
                const text = buffer.toString('utf-8');
                if (text.includes('502 Bad Gateway') || text.includes('504 Gateway Time-out')) {
                  if (attempt < maxRetries) return setTimeout(doRequest, 500);
                }
                resolve(text);
              }
            } else if (isChunked && buffer.slice(-5).toString().includes('0\r\n\r\n')) {
              if (!resolved) {
                resolved = true;
                cleanup();
                const text = buffer.toString('utf-8');
                if (text.includes('502 Bad Gateway') || text.includes('504 Gateway Time-out')) {
                  if (attempt < maxRetries) return setTimeout(doRequest, 500);
                }
                resolve(text);
              }
            }
          });

          tlsSocket.on('end', () => {
            if (resolved) return;
            resolved = true;
            cleanup();
            const text = Buffer.concat(chunks).toString('utf-8');
            if (text.includes('502 Bad Gateway') || text.includes('504 Gateway Time-out')) {
              if (attempt < maxRetries) {
                const delay = Math.pow(2, attempt) * 500 + Math.random() * 200;
                return setTimeout(doRequest, delay);
              }
            }
            resolve(text);
          });

          tlsSocket.on('error', retryOrReject);
        });

        rawSocket.setTimeout(18000, () => retryOrReject(new Error('Connection timeout')));
        rawSocket.on('error', retryOrReject);
      } catch (err) {
        retryOrReject(err);
      }
    };

    doRequest();
  });
}

/**
 * Parses video card metadata from a listing HTML page
 */
function parseListing(html) {
  const videos = [];
  const seenSlugs = new Set();

  const regex = /<a\b[^>]*class=["'][^"']*muestra-escena[^"']*["'][^>]*href=["'](?:https:\/\/www\.cumlouder\.com)?\/porn-video\/([^"'\/]+)\/["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const slug = match[1];
    if (seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    const block = match[2];

    // Extract thumbnail
    const thumbMatch = block.match(/data-src=["']([^"']+)["']/i) ||
                       block.match(/src=["']([^"']+)["']/i);
    let rawThumb = thumbMatch ? thumbMatch[1] : '';
    if (rawThumb && rawThumb.startsWith('//')) {
      rawThumb = 'https:' + rawThumb;
    }

    // Extract title
    const titleMatch = block.match(/alt=["']([^"']+)["']/i) ||
                       block.match(/<h\d[^>]*>([\s\S]*?)<\/h\d>/i);
    let title = titleMatch ? (titleMatch[1] || titleMatch[0]) : slug.replace(/-/g, ' ');
    title = title.replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, '').trim();

    // Extract duration
    const durMatch = block.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    const duration = durMatch ? durMatch[1] : 'HD';

    // Build resilient thumbnail URL
    const thumb = rawThumb 
      ? `/api/thumb?url=${encodeURIComponent(rawThumb)}` 
      : '';

    videos.push({
      id: `cl-${slug}`,
      slug,
      title: title || slug.replace(/-/g, ' '),
      postUrl: `https://www.cumlouder.com/porn-video/${slug}/`,
      thumb,
      rawThumb,
      duration: duration || 'HD',
      type: 'mp4'
    });
  }

  return videos;
}

/**
 * Resolves media stream (direct MP4 and/or embed URL) for a video
 * Upgrade 1: If numericId is passed or known, fetches lightweight /embed/{numericId}/ in <600ms
 * If slug is passed, resolves detail page once, records numericId for all future refreshes.
 */
async function resolveVideo(slugOrId, numericIdHint = null) {
  try {
    let html = '';
    let numericId = numericIdHint;
    let slug = '';

    if (numericIdHint || /^\d+$/.test(String(slugOrId))) {
      numericId = String(numericIdHint || slugOrId);
      html = await fetchCumlouder(`/embed/${numericId}/`);
    } else {
      slug = String(slugOrId).replace(/^cl-/, '');
      html = await fetchCumlouder(`/porn-video/${slug}/`);
      const embedMatch = html.match(/\/embed\/(\d+)\//) || html.match(/rate_video\.php\?s=(\d+)/);
      if (embedMatch) {
        numericId = embedMatch[1];
      }
    }

    // Extract direct MP4 stream URL from any CDN (m4cdnst, m5cdnst, mediacdnst, cdnst, etc.)
    const mp4Match = html.match(/<source\b[^>]*src=["'](https:\/\/[^"']+\.mp4\?[^"']+)["']/i) ||
                     html.match(/src=["'](https:\/\/[^"']+\.cumlouder\.com\/[^"']+\.mp4\?[^"']+)["']/i) ||
                     html.match(/https:\/\/[^\s"'<>]+\.cumlouder\.com\/[^\s"'<>]+\.mp4\?[^\s"'<>]+/i);
    const streamUrl = mp4Match ? (mp4Match[1] || mp4Match[0]) : '';

    // Extract timestamp from ?secure=...,<timestamp>
    let expiresAt = Math.floor(Date.now() / 1000) + 11400; // default 3.1h
    if (streamUrl) {
      const timeMatch = streamUrl.match(/%2C(\d+)/i) || streamUrl.match(/,(\d+)/);
      if (timeMatch) {
        expiresAt = parseInt(timeMatch[1], 10);
      }
    }

    // Extract poster image
    const posterMatch = html.match(/poster=["']([^"']+)["']/i);
    let rawPoster = posterMatch ? posterMatch[1] : '';
    if (rawPoster && rawPoster.startsWith('//')) rawPoster = 'https:' + rawPoster;
    const poster = rawPoster ? `/api/thumb?url=${encodeURIComponent(rawPoster)}` : '';

    const embedUrl = numericId ? `https://www.cumlouder.com/embed/${numericId}/` : '';

    return {
      ok: true,
      id: slug ? `cl-${slug}` : `cl-${numericId}`,
      slug,
      numericId,
      embedUrl,
      streamUrl: streamUrl || '',
      poster,
      rawPoster,
      expiresAt,
      verifiedAt: Date.now()
    };
  } catch (err) {
    console.error(`[Cumlouder Scraper] Resolve error for ${slugOrId}:`, err.message);
    return null;
  }
}

/**
 * Scrapes a listing page
 */
async function getListingPage(page = 1, category = '') {
  let path = '/porn/';
  if (category && category !== 'all') {
    path = page > 1 ? `/series/${category}/${page}/` : `/series/${category}/`;
  } else {
    path = page > 1 ? `/${page}/` : '/porn/';
  }
  const html = await fetchCumlouder(path);
  return parseListing(html);
}

module.exports = {
  fetchCumlouder,
  parseListing,
  resolveVideo,
  getListingPage
};
