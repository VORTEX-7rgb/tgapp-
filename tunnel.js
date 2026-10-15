const localtunnel = require('localtunnel');
const https = require('https');

function getTunnelPassword() {
  return new Promise(resolve => {
    https.get('https://loca.lt/mytunnelpassword', res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d.trim()));
    }).on('error', () => resolve(''));
  });
}

async function start() {
  try {
    console.log('Connecting tunnel to port 3000...');
    const tunnel = await localtunnel({ port: 3000 });
    const password = await getTunnelPassword();

    console.log('\n======================================================');
    console.log('🚀 YOUR LIVE PUBLIC HTTPS MINI APP URL:');
    console.log(tunnel.url);
    console.log('======================================================');
    if (password) {
      console.log(`🔑 Localtunnel IP / Password (if requested on first visit): ${password}`);
    }
    console.log('⚠️  KEEP THIS TERMINAL RUNNING. Do not close it or the tunnel will disconnect.\n');

    // Keep Node process alive indefinitely
    const keepAlive = setInterval(() => {}, 1000 * 60 * 60);

    tunnel.on('close', () => {
      console.log('Tunnel closed.');
      clearInterval(keepAlive);
      process.exit(0);
    });

    tunnel.on('error', (err) => {
      console.error('Tunnel error:', err.message);
    });

    process.on('SIGINT', () => {
      tunnel.close();
      process.exit(0);
    });
  } catch (e) {
    console.error('Failed to start tunnel:', e);
  }
}

start();
