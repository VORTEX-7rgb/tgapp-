const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const scraper = require('./scraper');

const app = express();
const PORT = process.env.PORT || 4000;
const BRIDGE_HOST = process.env.BRIDGE_HOST || 'http://100.94.112.65:5050';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 1. Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'StreamX Isolated Engine', time: Date.now() });
});

// 2. Feed / Catalog API
app.get('/api/feed', async (req, res) => {
  try {
    const cat = req.query.cat || 'trending';
    const page = req.query.page || 1;
    const data = await scraper.getFeed(cat, page);
    return res.json(data);
  } catch (err) {
    console.error('[StreamX] Feed error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 3. Resolve Direct Stream API
app.get('/api/stream', async (req, res) => {
  const target = req.query.url || req.query.id;
  if (!target) return res.status(400).json({ ok: false, error: 'Missing target url or id' });

  try {
    const streamData = await scraper.resolveStream(target);
    return res.json(streamData);
  } catch (err) {
    console.error('[StreamX] Resolve stream error:', err.message);
    return res.status(500).json({ ok: false, error: err.message });
  }
});

// 4. Stream Play Proxy (Relays Range requests to VPS Bridge)
app.all('/api/play', (req, res) => {
  const cdnUrl = req.query.url;
  if (!cdnUrl) return res.status(400).send('Missing url');

  const parsedBridge = new URL(BRIDGE_HOST);
  const upstreamPath = `/api/play?url=${encodeURIComponent(cdnUrl)}`;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };
  if (req.headers.range) {
    headers['Range'] = req.headers.range;
  }

  const clientReq = http.request({
    protocol: parsedBridge.protocol,
    hostname: parsedBridge.hostname,
    port: parsedBridge.port || 80,
    path: upstreamPath,
    method: req.method,
    headers
  }, upstreamRes => {
    res.status(upstreamRes.statusCode || 200);
    res.setHeader('Content-Type', upstreamRes.headers['content-type'] || 'video/mp4');
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');

    if (upstreamRes.headers['content-range']) {
      res.setHeader('Content-Range', upstreamRes.headers['content-range']);
    }
    if (upstreamRes.headers['content-length']) {
      res.setHeader('Content-Length', upstreamRes.headers['content-length']);
    }

    if (req.method === 'HEAD') {
      return res.end();
    }

    upstreamRes.pipe(res);
  });

  clientReq.on('error', err => {
    if (!res.headersSent) res.status(502).send('Stream proxy connection error');
  });

  req.pipe(clientReq);
});

// 5. Thumbnail Image Proxy
app.get('/api/thumb', (req, res) => {
  const thumbUrl = req.query.url;
  if (!thumbUrl) return res.status(400).send('Missing thumb url');

  const parsedBridge = new URL(BRIDGE_HOST);
  const upstreamPath = `/api/thumb?url=${encodeURIComponent(thumbUrl)}`;

  http.get({
    protocol: parsedBridge.protocol,
    hostname: parsedBridge.hostname,
    port: parsedBridge.port || 80,
    path: upstreamPath,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  }, upstreamRes => {
    res.status(upstreamRes.statusCode || 200);
    res.setHeader('Content-Type', upstreamRes.headers['content-type'] || 'image/webp');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.setHeader('Access-Control-Allow-Origin', '*');
    upstreamRes.pipe(res);
  }).on('error', () => {
    if (!res.headersSent) res.status(404).send('Image error');
  });
});

app.listen(PORT, () => {
  console.log(`[StreamX] Isolated Streaming Engine running on http://localhost:${PORT}`);
});
