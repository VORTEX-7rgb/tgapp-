const net = require('net');
const tls = require('tls');
const { Transform, Duplex } = require('stream');

const HOST = 'usersporn.com';
const CLOUDFLARE_IP = '104.21.13.66';

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
 * Fetch raw HTTP response from usersporn.com with DPI bypass & retry logic for 502 Bad Gateway
 */
function fetchUsersPorn(path = '/', maxRetries = 3) {
  return new Promise((resolve, reject) => {
    let attempt = 0;

    const doRequest = () => {
      attempt++;
      let rawSocket = null;
      let tlsSocket = null;
      let resolved = false;

      const cleanup = () => {
        try { if (tlsSocket) tlsSocket.destroy(); } catch (e) {}
        try { if (rawSocket) rawSocket.destroy(); } catch (e) {}
      };

      const retryOrReject = (err) => {
        cleanup();
        if (resolved) return;
        resolved = true;
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 400 + Math.random() * 200;
          setTimeout(doRequest, delay);
        } else {
          reject(err);
        }
      };

      try {
        rawSocket = net.connect(443, CLOUDFLARE_IP, () => {
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
          tlsSocket.on('data', c => chunks.push(c));
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

        rawSocket.setTimeout(12000, () => retryOrReject(new Error('Connection timeout')));
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
  const seenIds = new Set();

  // Find all /video/{id}/ links
  const regex = /<a\b[^>]*href=["'](?:\/video\/|https:\/\/usersporn\.com\/video\/)(\d+)\/[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const id = match[1];
    if (seenIds.has(id)) continue;
    seenIds.add(id);

    const block = match[2];
    
    // Extract thumbnail
    const thumbMatch = block.match(/data-src=["']([^"']+)["']/i) ||
                       block.match(/src=["']([^"']+)["']/i);
    const rawThumb = thumbMatch ? thumbMatch[1] : '';

    // Extract title
    const titleMatch = block.match(/<img\b[^>]*alt=["']([^"']+)["']/i) ||
                       block.match(/title=["']([^"']+)["']/i);
    let title = titleMatch ? titleMatch[1].trim() : `Video ${videos.length + 1}`;
    title = title.replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, '').trim();

    // Extract duration
    const durMatch = block.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
    const duration = durMatch ? durMatch[1] : '';

    // Build wsrv.nl edge thumbnail URL
    const thumb = rawThumb 
      ? `https://wsrv.nl/?url=${encodeURIComponent(rawThumb)}&w=480&output=webp` 
      : '';

    videos.push({
      id: `up-${id}`,
      rawId: id,
      title: title || `Video ${videos.length + 1}`,
      postUrl: `https://usersporn.com/video/${id}/`,
      thumb,
      rawThumb,
      duration: duration || 'HD'
    });
  }

  return videos;
}

/**
 * Resolves direct media streams for a single video ID from fp.spac.me
 */
async function resolveVideo(rawId) {
  try {
    const html = await fetchUsersPorn(`/video/${rawId}/`);
    
    // Extract title
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
    let title = titleMatch ? titleMatch[1].replace(/|UsersPorn.*$/gi, '').trim() : `Video ${rawId}`;
    title = title.replace(/&#\d+;/g, '').replace(/&[a-z]+;/g, '').trim();

    // Extract all fp.spac.me MP4 download links
    const mp4Matches = [...html.matchAll(/https:\/\/fp\.spac\.me\/[^\s"'\<>]+(?:\/file\.mp4|\.mp4)/gi)].map(m => m[0]);
    if (mp4Matches.length === 0) {
      return null;
    }

    // Inspect first sample URL:
    // https://fp.spac.me/htz-xfc21/htz-xcs16/v/{routing}/{timestamp}/{videoId}/{quality}/{hash}/file.mp4
    const sample = mp4Matches[0];
    const parts = sample.split('/');
    // Find index of videoId
    const idIdx = parts.indexOf(rawId);
    if (idIdx === -1) {
      return null;
    }

    const basePath = parts.slice(0, idIdx + 1).join('/'); // .../v/.../timestamp/rawId
    const hashTail = parts.slice(idIdx + 2).join('/'); // hash/file.mp4
    const expiresAt = Math.floor(Date.now() / 1000) + 7200; // Fresh token valid for 2 hours

    // Check which quality keys actually exist in HTML
    const availableQualities = [];
    ['x0', 'x1', 'x2', 'x3'].forEach(q => {
      if (html.includes(`/${rawId}/${q}/`)) {
        availableQualities.push(q);
      }
    });
    if (availableQualities.length === 0) {
      availableQualities.push('x0', 'x1', 'x2');
    }

    // Default stream: prefer x2 (720p HD), fallback to x1 or x0
    const defaultQuality = availableQualities.includes('x2') ? 'x2' : (availableQualities.includes('x1') ? 'x1' : 'x0');
    const defaultStreamUrl = `${basePath}/${defaultQuality}/${hashTail}`;

    // Extract poster image
    const posterMatch = html.match(/poster=["']([^"']+)["']/i) ||
                        html.match(/https:\/\/inf-xts\.spac\.me\/[^\s"'\<>]+\.jpg/i);
    const rawPoster = posterMatch ? (posterMatch[1] || posterMatch[0]) : '';
    const poster = rawPoster ? `https://wsrv.nl/?url=${encodeURIComponent(rawPoster)}&w=720&output=webp` : '';

    return {
      ok: true,
      id: `up-${rawId}`,
      rawId,
      title,
      streamUrl: defaultStreamUrl,
      basePath,
      hashTail,
      qualities: availableQualities,
      defaultQuality,
      qualityUrls: {
        '360p': availableQualities.includes('x0') ? `${basePath}/x0/${hashTail}` : defaultStreamUrl,
        '480p': availableQualities.includes('x1') ? `${basePath}/x1/${hashTail}` : defaultStreamUrl,
        '720p': availableQualities.includes('x2') ? `${basePath}/x2/${hashTail}` : defaultStreamUrl,
        '1080p': availableQualities.includes('x3') ? `${basePath}/x3/${hashTail}` : defaultStreamUrl
      },
      poster,
      rawPoster,
      expiresAt,
      verifiedAt: Date.now()
    };
  } catch (err) {
    console.error(`[UsersPorn Scraper] Resolve error for ${rawId}:`, err.message);
    return null;
  }
}

/**
 * Scrapes a listing page (page 1, 2, 3...)
 */
async function getListingPage(page = 1) {
  const path = page > 1 ? `/videocat/p${page}/` : '/';
  const html = await fetchUsersPorn(path);
  return parseListing(html);
}

module.exports = {
  fetchUsersPorn,
  parseListing,
  resolveVideo,
  getListingPage
};
