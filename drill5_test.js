const https = require('https');
const http = require('http');

const CDN_URL = "https://c7.trafficdeposit.com/widi/c260xzq2k129rzg2867zu0v/SS4zmsxIDvYOUhwkKAY78A/1792183375/698214cf288f9/6ad18f41d0f97.vid";
const CDN8_URL = "https://sxyprn.com/cdn8/NzAtc3h5cHJuLmNvbS00OQ../c7/c260xzq2k129rzg2867zu0v/EspK_uo5qfK0OfBC0tDi4g/1792183375/zv629n8w2g144jcbfe2i8t80f79/hz6haddc1e8wf74j1rdx0bf69b7.vid";

function probe(url, headers = {}) {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = https.request({
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || 443,
        path: parsed.pathname + parsed.search,
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          ...headers
        }
      }, (res) => {
        let chunkLen = 0;
        let preview = '';
        res.on('data', (d) => {
          chunkLen += d.length;
          if (preview.length < 200) preview += d.toString('utf-8');
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            bytes: chunkLen,
            preview: preview.slice(0, 100)
          });
        });
      });
      req.on('error', (err) => resolve({ error: err.message }));
      req.setTimeout(8000, () => {
        req.destroy();
        resolve({ error: 'Timeout 8s' });
      });
      req.end();
    } catch (e) {
      resolve({ error: e.message });
    }
  });
}

async function runDrill5() {
  console.log("================================================================================");
  console.log("DRILL 5: TESTING DIRECT CLIENT PLAYBACK FROM LOCAL MACHINE (FOREIGN RESIDENTIAL IP)");
  console.log("================================================================================");
  console.log(`Target CDN URL: ${CDN_URL}`);

  // 1. Probe (a): NO Referer, No Cookies, Range: bytes=0-1024
  console.log("\n[Probe A] Testing CDN with NO Referer (referrerPolicy: no-referrer)...");
  const resA = await probe(CDN_URL, { 'Range': 'bytes=0-1024' });
  console.log(`Status: ${resA.status} | Bytes: ${resA.bytes}`);
  console.log(`CORS Access-Control-Allow-Origin: ${resA.headers ? resA.headers['access-control-allow-origin'] : 'None'}`);
  console.log(`Accept-Ranges: ${resA.headers ? resA.headers['accept-ranges'] : 'None'}`);
  console.log(`Content-Range: ${resA.headers ? resA.headers['content-range'] : 'None'}`);
  console.log(`Content-Type: ${resA.headers ? resA.headers['content-type'] : 'None'}`);
  const passA = resA.status === 206 && resA.bytes === 1025;
  console.log(`>>> PROBE A VERDICT: ${passA ? 'PASS (Direct playback WITHOUT Referer works!)' : 'FAIL'}`);

  // 2. Probe (b): Wrong Referer (Vercel Domain)
  console.log("\n[Probe B] Testing CDN with WRONG Referer (e.g. Vercel / custom domain)...");
  const resB = await probe(CDN_URL, {
    'Referer': 'https://my-streamx-app.vercel.app/watch/6ad18f41d0f97',
    'Origin': 'https://my-streamx-app.vercel.app',
    'Range': 'bytes=0-1024'
  });
  console.log(`Status: ${resB.status} | Bytes: ${resB.bytes}`);
  console.log(`Content-Range: ${resB.headers ? resB.headers['content-range'] : 'None'}`);
  const passB = resB.status === 206 && resB.bytes === 1025;
  console.log(`>>> PROBE B VERDICT: ${passB ? 'PASS (CDN allows external Vercel Referer!)' : 'FAIL (Blocked by Referer)'}`);

  // 3. Probe (c): No Cookies (Pure Clean Request)
  console.log("\n[Probe C] Confirming CDN works without ANY sxyprn cookies...");
  console.log(`Status: ${resA.status} (Verified in Probe A - zero cookies sent)`);
  const passC = passA;
  console.log(`>>> PROBE C VERDICT: ${passC ? 'PASS (Zero cookies required by CDN!)' : 'FAIL'}`);

  // 4. Probe (d): SxyPrn cdn8 302 endpoint from foreign IP WITHOUT cf_clearance
  console.log("\n[Probe D] Testing sxyprn.com /cdn8/... 302 endpoint from Foreign IP WITHOUT cf_clearance...");
  const resD = await probe(CDN8_URL, {});
  console.log(`Status: ${resD.status} | Location: ${resD.headers ? resD.headers['location'] : 'None'}`);
  if (resD.status === 403 || resD.status === 503) {
    console.log(`>>> PROBE D VERDICT: REQUIREMENT DETECTED (sxyprn.com cdn8 requires Cloudflare clearance!)`);
    console.log(`    Meaning: The client cannot call /cdn8/ directly. The VPS must perform the 302 redirect.`);
  } else if (resD.status === 302) {
    console.log(`>>> PROBE D VERDICT: PASS (/cdn8/ redirects even without Cloudflare clearance!)`);
  } else {
    console.log(`>>> PROBE D VERDICT: Status ${resD.status}`);
  }

  // 5. Probe (e): Testing browser CORS preflight (OPTIONS request)
  console.log("\n[Probe E] Testing browser CORS preflight on CDN URL...");
  const resE = await new Promise((resolve) => {
    const parsed = new URL(CDN_URL);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://my-streamx-app.vercel.app',
        'Access-Control-Request-Method': 'GET',
        'Access-Control-Request-Headers': 'range'
      }
    }, (res) => resolve({ status: res.statusCode, headers: res.headers }));
    req.on('error', (e) => resolve({ error: e.message }));
    req.end();
  });
  console.log(`OPTIONS Status: ${resE.status}`);
  console.log(`Access-Control-Allow-Origin: ${resE.headers ? resE.headers['access-control-allow-origin'] : 'None'}`);
  console.log(`Access-Control-Allow-Headers: ${resE.headers ? resE.headers['access-control-allow-headers'] : 'None'}`);

  console.log("\n================================================================================");
  console.log("DRILL 5 SUMMARY & ARCHITECTURAL IMPLICATIONS");
  console.log("================================================================================");
}

runDrill5();
