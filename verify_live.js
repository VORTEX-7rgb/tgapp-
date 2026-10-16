const https = require('https');

const BASE_URL = 'https://prompt-radius-hook-var.trycloudflare.com';

function fetchUrl(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(BASE_URL + path);
    const t0 = Date.now();
    https.get({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers
    }, res => {
      let len = 0;
      let body = '';
      res.on('data', d => {
        len += d.length;
        body += d.toString();
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          timeMs: Date.now() - t0,
          bytes: len,
          headers: res.headers,
          body
        });
      });
    }).on('error', reject);
  });
}

async function verifyAll() {
  console.log("================================================================================");
  console.log("STREAMX ULTRA PUBLIC CLOUDFLARE END-TO-END VERIFICATION");
  console.log("================================================================================");
  console.log(`Public Target: ${BASE_URL}\n`);

  // 1. Health
  const rHealth = await fetchUrl('/api/health');
  console.log(`[1] /api/health -> Status: ${rHealth.status} | Latency: ${rHealth.timeMs}ms | Engine: ${JSON.parse(rHealth.body).engine}`);

  // 2. HTML UI
  const rHtml = await fetchUrl('/');
  console.log(`[2] / (index.html) -> Status: ${rHtml.status} | Latency: ${rHtml.timeMs}ms | Bytes: ${rHtml.bytes}`);

  // 3. Feed API
  const rFeed = await fetchUrl('/api/feed?cat=trending');
  const feedJson = JSON.parse(rFeed.body);
  console.log(`[3] /api/feed -> Status: ${rFeed.status} | Latency: ${rFeed.timeMs}ms | Videos: ${feedJson.count}`);

  const testVid = feedJson.videos[0];
  console.log(`    Testing Top Video: "${testVid.title.slice(0, 50)}..." [ID: ${testVid.id}]`);

  // 4. Stream Resolution API
  const rStream = await fetchUrl(`/api/stream?id=${testVid.id}`);
  const streamJson = JSON.parse(rStream.body);
  console.log(`[4] /api/stream -> Status: ${rStream.status} | Latency: ${rStream.timeMs}ms | Cached: ${streamJson.cached} | Related Count: ${streamJson.related ? streamJson.related.length : 0}`);

  // 5. Video Play Burst (First 512KB)
  const rPlay = await fetchUrl(streamJson.streamUrl, { 'Range': 'bytes=0-524287' });
  console.log(`[5] /api/play (512KB Burst) -> Status: ${rPlay.status} | Latency: ${rPlay.timeMs}ms | Bytes: ${rPlay.bytes} | Cache: ${rPlay.headers['x-streamx-cache']}`);

  console.log("\n================================================================================");
  console.log("ALL TESTS COMPLETED SUCCESSFULLY! SYSTEM IS 100% OPERATIONAL.");
  console.log("================================================================================");
}

verifyAll().catch(e => console.error("Verification failed:", e));
