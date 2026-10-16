const https = require('https');

function ssut51(arg) {
  const s = String(arg).replace(/[^0-9]/g, '');
  return s.split('').reduce((acc, c) => acc + parseInt(c, 10), 0);
}

function boo(ss, es, host = 'sxyprn.com') {
  const raw = Buffer.from(ss + '-' + host + '-' + es, 'utf-8');
  return raw.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '.');
}

function preda(tmp) {
  const val = parseInt(tmp[5], 10) - (ssut51(tmp[6]) + ssut51(tmp[7]));
  tmp[5] = String(val);
  return tmp;
}

function decodeVnfo(rawSrc, host = 'sxyprn.com') {
  const tmp = rawSrc.split('/');
  const token = boo(ssut51(tmp[6]), ssut51(tmp[7]), host);
  tmp[1] = tmp[1] + '8/' + token;
  return preda(tmp).join('/');
}

function requestHttp(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, options, (res) => {
      let data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(data)
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function run() {
  console.log('--- Step 1: Getting a video from SxyPrn HTML via VPS ---');
  // First, let's fetch a post HTML to see the raw data-vnfo
  const feedRes = await requestHttp('https://prompt-radius-hook-var.trycloudflare.com/api/feed?cat=trending&page=1');
  const feed = JSON.parse(feedRes.body.toString());
  const v = feed.videos[2];
  console.log('Target video:', v.id, v.title);

  // Let's resolve the stream on VPS to see what decoded path it got
  const resolveRes = await requestHttp('https://prompt-radius-hook-var.trycloudflare.com/api/stream?id=' + v.id);
  const streamData = JSON.parse(resolveRes.body.toString());
  console.log('StreamData rawCdnUrl:', streamData.rawCdnUrl);

  // Now, what happens if our LOCAL India IP tries to fetch that CDN URL directly?
  console.log('\n--- Step 2: Testing direct CDN URL fetch from LOCAL India IP ---');
  console.log('Attempting fetch with NO referer...');
  const cdnNoRef = await requestHttp(streamData.rawCdnUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Range': 'bytes=0-1000'
    }
  });
  console.log('Result (No referer):', cdnNoRef.statusCode, cdnNoRef.headers['content-range'] || cdnNoRef.headers['location']);

  console.log('\nAttempting fetch with Referer: https://sxyprn.com/ ...');
  const cdnWithRef = await requestHttp(streamData.rawCdnUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://sxyprn.com/',
      'Range': 'bytes=0-1000'
    }
  });
  console.log('Result (Referer sxyprn.com):', cdnWithRef.statusCode, cdnWithRef.headers['content-range'] || cdnWithRef.headers['location']);

  // Now let's test what happens if our LOCAL India IP calls the 302 redirect URL directly!
  // To do that, we need the /vid8/... path!
  // Let's get the raw data-vnfo from the VPS or post page
  console.log('\n--- Step 3: Can our LOCAL India IP request https://sxyprn.com/vid8/... directly? ---');
  // Let's test if sxyprn.com blocks our local IP on /post/ or /vid8/
  try {
    const postRes = await requestHttp('https://sxyprn.com/post/' + v.id + '.html', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    console.log('Direct GET https://sxyprn.com/post/' + v.id + '.html status:', postRes.statusCode);
    if (postRes.statusCode === 403 || postRes.body.toString().includes('Just a moment...')) {
      console.log('=> sxyprn.com Cloudflare Challenge BLOCKS direct requests from India without clearance cookie!');
    } else {
      console.log('=> sxyprn.com allowed direct request! Length:', postRes.body.length);
    }
  } catch (err) {
    console.log('Error contacting sxyprn directly:', err.message);
  }
}

run().catch(console.error);
