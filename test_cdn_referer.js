const https = require('https');

// Fresh CDN URL
const CDN_URL = "https://c7.trafficdeposit.com/widi/c260xzq2k129rzg2867zu0v/SS4zmsxIDvYOUhwkKAY78A/1792183375/698214cf288f9/6ad18f41d0f97.vid";

function testWithHeaders(name, headers) {
  return new Promise((resolve) => {
    const parsed = new URL(CDN_URL);
    const req = https.request({
      hostname: parsed.hostname,
      path: parsed.pathname,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Range': 'bytes=0-100',
        ...headers
      }
    }, res => {
      let len = 0;
      res.on('data', d => len += d.length);
      res.on('end', () => resolve({ name, status: res.statusCode, headers: res.headers, len }));
    });
    req.on('error', e => resolve({ name, error: e.message }));
    req.end();
  });
}

async function run() {
  console.log("TESTING SPECIFIC HEADERS FROM LOCAL RESIDENTIAL IP (INDIA):");
  
  // Test 1: With SxyPrn Referer
  const t1 = await testWithHeaders("With SxyPrn Referer", { 'Referer': 'https://sxyprn.com/' });
  console.log(`1. Referer: https://sxyprn.com/ -> Status: ${t1.status} | Bytes: ${t1.len}`);

  // Test 2: With SxyPrn Post Referer
  const t2 = await testWithHeaders("With SxyPrn Post Referer", { 'Referer': 'https://sxyprn.com/post/6ad18f41d0f97.html' });
  console.log(`2. Referer: https://sxyprn.com/post/6ad18f41d0f97.html -> Status: ${t2.status} | Bytes: ${t2.len}`);

  // Test 3: No Referer at all
  const t3 = await testWithHeaders("No Referer", {});
  console.log(`3. No Referer -> Status: ${t3.status} | Bytes: ${t3.len}`);

  // Now let's check: does the VPS get 206 on this SAME URL right now?
}

run();
