const http = require('http');

const BRIDGE_HOST = process.env.BRIDGE_HOST || 'http://100.94.112.65:5050';

function fetchJson(url, timeoutMs = 25000) {
  return new Promise((resolve, reject) => {
    try {
      const parsed = new URL(url);
      const req = http.get({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 80,
        path: parsed.pathname + parsed.search,
        headers: { 'Accept': 'application/json' }
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Failed to parse JSON response: ${data.slice(0, 200)}`));
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(timeoutMs, () => {
        req.destroy();
        reject(new Error(`Timeout (${timeoutMs}ms) requesting ${url}`));
      });
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Fetch video feed from SxyPrn via StreamX VPS Bridge
 */
async function getFeed(cat = 'trending', page = 1) {
  const bridgeUrl = `${BRIDGE_HOST}/api/feed?cat=${encodeURIComponent(cat)}&page=${encodeURIComponent(page)}`;
  const data = await fetchJson(bridgeUrl, 25000);
  if (!data || !data.ok) {
    throw new Error(data && data.error ? data.error : 'Failed to retrieve catalog feed');
  }

  // Rewrite poster paths to route through local proxy
  const videos = (data.videos || []).map(v => ({
    ...v,
    poster: v.rawPoster ? `/api/thumb?url=${encodeURIComponent(v.rawPoster)}` : ''
  }));

  return {
    ok: true,
    cat: data.cat || cat,
    page: Number(page),
    count: videos.length,
    videos
  };
}

/**
 * Resolve direct video stream for post ID or SxyPrn URL
 */
async function resolveStream(videoUrlOrId) {
  const bridgeUrl = `${BRIDGE_HOST}/api/stream?url=${encodeURIComponent(videoUrlOrId)}`;
  const data = await fetchJson(bridgeUrl, 50000);
  if (!data || !data.ok) {
    throw new Error(data && data.error ? data.error : 'Failed to resolve stream link');
  }

  return {
    ok: true,
    id: data.id,
    title: data.title,
    rawCdnUrl: data.rawCdnUrl,
    streamUrl: `/api/play?url=${encodeURIComponent(data.rawCdnUrl)}`,
    poster: data.poster ? `/api/thumb?url=${encodeURIComponent(data.poster)}` : '',
    format: data.format || 'mp4'
  };
}

module.exports = {
  getFeed,
  resolveStream,
  BRIDGE_HOST
};
