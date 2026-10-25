const express = require('express');
const path = require('path');
const https = require('https');
const http = require('http');
const reelsCatalog = require('./reels_catalog');

let fetchPixDpi = null;
try {
  fetchPixDpi = require('../upskirt_scraper').fetchPixDpi;
} catch (_) {}

const thumbCache = new Map();

const app = express();
const PORT = process.env.PORT || 3000;

// Required for POST /api/reels/feed and POST /api/reels/telemetry
app.use(express.json({ limit: '256kb' }));

// CORS & Anti-Cache Headers
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Serve Static Frontend Assets
app.use(express.static(path.join(__dirname, 'public')));

// Resilient Thumbnail Proxy with DPI Bypass
app.get('/api/thumb', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) return res.status(400).send('Missing url');

  if (thumbCache.has(imageUrl)) {
    const cached = thumbCache.get(imageUrl);
    res.setHeader('Content-Type', cached.contentType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    return res.send(cached.data);
  }

  if ((imageUrl.includes('pix.upskirt.tv') || imageUrl.includes('upskirt.tv')) && fetchPixDpi) {
    try {
      const result = await fetchPixDpi(imageUrl);
      if (result && result.data && result.data.length > 200) {
        if (thumbCache.size > 1000) {
          const firstKey = thumbCache.keys().next().value;
          thumbCache.delete(firstKey);
        }
        thumbCache.set(imageUrl, result);
        res.setHeader('Content-Type', result.contentType || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        return res.send(result.data);
      }
    } catch (err) {
      console.warn('[Standalone Pix DPI Error]:', err.message);
      res.setHeader('Content-Type', 'image/svg+xml');
      return res.send('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="100%" height="100%" fill="#18181b"/><text x="50%" y="50%" fill="#71717a" font-family="sans-serif" font-size="14" text-anchor="middle" dominant-baseline="middle">Upskirt Preview</text></svg>');
    }
  }

  try {
    const parsed = new URL(imageUrl);
    const transport = parsed.protocol === 'https:' ? https : http;
    transport.get(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      timeout: 7000
    }, upstreamRes => {
      if (upstreamRes.statusCode !== 200) return res.redirect(imageUrl);
      const chunks = [];
      upstreamRes.on('data', c => chunks.push(c));
      upstreamRes.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = upstreamRes.headers['content-type'] || 'image/jpeg';
        thumbCache.set(imageUrl, { data: buffer, contentType });
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
        res.send(buffer);
      });
    }).on('error', () => res.redirect(imageUrl));
  } catch (e) {
    res.status(500).send('Error loading thumbnail');
  }
});

// Upskirt MP4 / HLS Stream DPI Bypass Proxy for Standalone Reels
app.get('/api/ut/stream', async (req, res) => {
  const streamUrl = req.query.url;
  if (!streamUrl) return res.status(400).send('Missing url');

  const UT_STREAM_IPS = [
    '79.127.138.15', '79.127.138.28', '79.127.138.21', '79.127.138.18',
    '79.127.235.9', '79.127.213.228', '79.127.235.3', '79.127.235.5'
  ];

  try {
    const parsed = new URL(streamUrl);
    const ip = UT_STREAM_IPS[Math.floor(Math.random() * UT_STREAM_IPS.length)];

    const net = require('net');
    const tls = require('tls');
    const { Transform, Duplex } = require('stream');

    class DpiSplitterStream extends Transform {
      constructor() { super(); this.first = true; }
      _transform(chunk, enc, cb) {
        if (this.first && chunk.length > 30) {
          this.first = false;
          this.push(chunk.slice(0, 30));
          setTimeout(() => { this.push(chunk.slice(30)); cb(); }, 40);
        } else {
          this.push(chunk);
          cb();
        }
      }
    }

    let clientDisconnected = false;
    let raw = null;
    let tlsSocket = null;

    const cleanup = () => {
      try { if (tlsSocket) tlsSocket.destroy(); } catch (_) {}
      try { if (raw) raw.destroy(); } catch (_) {}
    };

    req.on('close', () => {
      clientDisconnected = true;
      cleanup();
    });

    raw = net.connect(443, ip, () => {
      if (clientDisconnected) return cleanup();
      const splitter = new DpiSplitterStream();
      splitter.pipe(raw);
      const duplex = new Duplex({ read() {}, write(c, e, cb) { splitter.write(c, e, cb); } });
      raw.on('data', c => duplex.push(c));
      raw.on('end', () => duplex.push(null));

      tlsSocket = tls.connect({ socket: duplex, servername: parsed.hostname, rejectUnauthorized: false }, () => {
        if (clientDisconnected) return cleanup();
        let reqHeaders = `${req.method} ${parsed.pathname}${parsed.search} HTTP/1.1\r\n` +
          `Host: ${parsed.hostname}\r\n` +
          `User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36\r\n` +
          `Referer: https://upskirt.tv/\r\n` +
          `Origin: https://upskirt.tv\r\n` +
          `Connection: close\r\n`;
        if (req.headers.range) {
          reqHeaders += `Range: ${req.headers.range}\r\n`;
        }
        reqHeaders += '\r\n';
        tlsSocket.write(reqHeaders);
      });

      let headerParsed = false;
      let leftover = Buffer.alloc(0);

      tlsSocket.on('data', chunk => {
        if (clientDisconnected) return cleanup();
        if (!headerParsed) {
          leftover = Buffer.concat([leftover, chunk]);
          const idx = leftover.indexOf('\r\n\r\n');
          if (idx !== -1) {
            headerParsed = true;
            const headerStr = leftover.slice(0, idx).toString('utf-8');
            const bodyChunk = leftover.slice(idx + 4);
            const firstLine = headerStr.split('\r\n')[0];
            const statusCode = parseInt(firstLine.split(' ')[1], 10) || 200;

            res.status(statusCode);
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Headers', '*');
            res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Content-Length, Accept-Ranges');
            res.setHeader('Accept-Ranges', 'bytes');

            headerStr.split('\r\n').slice(1).forEach(line => {
              const colon = line.indexOf(':');
              if (colon !== -1) {
                const k = line.slice(0, colon).trim().toLowerCase();
                const v = line.slice(colon + 1).trim();
                if (['content-type', 'content-length', 'content-range', 'cache-control'].includes(k)) {
                  res.setHeader(k, v);
                }
              }
            });

            if (bodyChunk.length > 0) {
              const ok = res.write(bodyChunk);
              if (!ok) {
                tlsSocket.pause();
                res.once('drain', () => tlsSocket.resume());
              }
            }
          }
        } else {
          const ok = res.write(chunk);
          if (!ok) {
            tlsSocket.pause();
            res.once('drain', () => tlsSocket.resume());
          }
        }
      });

      tlsSocket.on('end', () => res.end());
      tlsSocket.on('error', () => { if (!res.headersSent) res.status(502).send('Error proxying stream'); });
    });

    raw.on('error', () => { if (!res.headersSent) res.status(502).send('Stream connect error'); });
    raw.setTimeout(12000, () => {
      raw.destroy();
      if (!res.headersSent) res.status(504).send('Stream gateway timeout');
    });
  } catch (e) {
    if (!res.headersSent) res.status(400).send('Invalid stream URL');
  }
});

// Legacy GET Endpoint (Backwards-compatible for bots & older clients)
app.get('/api/reels', async (req, res) => {
  try {
    const source = req.query.source || 'all';
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const data = await reelsCatalog.getReels(source, page, limit);
    res.json(data);
  } catch (err) {
    console.error('[API GET /api/reels Error]:', err.message);
    res.status(500).json({ ok: false, error: err.message, reels: [] });
  }
});

// Personalized Dopamine Feed Endpoint
app.post('/api/reels/feed', async (req, res) => {
  try {
    const {
      source = 'trending',
      limit = 20,
      desiRatio = 0.5,
      topTags = {},
      dislikedTags = [],
      recentSeenIds = [],
      sessionSeed = Date.now()
    } = req.body || {};

    const data = await reelsCatalog.getPersonalizedFeed({
      source,
      limit,
      desiRatio,
      topTags,
      dislikedTags,
      recentSeenIds,
      sessionSeed
    });
    res.json(data);
  } catch (err) {
    console.error('[API POST /api/reels/feed Error]:', err.message);
    res.status(500).json({ ok: false, error: err.message, reels: [] });
  }
});

// Crowd Telemetry Ingestion Endpoint
app.post('/api/reels/telemetry', (req, res) => {
  try {
    const events = Array.isArray(req.body?.events) ? req.body.events : [];
    const updated = reelsCatalog.recordTelemetry(events);
    res.json({ ok: true, processed: updated });
  } catch (err) {
    console.error('[API POST /api/reels/telemetry Error]:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'fiziiii-reels-standalone',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Fallback for SPA routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`====================================================`);
  console.log(`FIZIIII REELS ENGINE (DOPAMINE V2)`);
  console.log(`Running Live on http://localhost:${PORT}`);
  console.log(`====================================================`);
});
