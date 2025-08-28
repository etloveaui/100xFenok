// Lightweight local CORS proxy for FRED in development
// Usage: node scripts/dev/fred-proxy.js

const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;
const TARGET_HOST = 'api.stlouisfed.org';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

const server = http.createServer((req, res) => {
  setCors(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    return res.end();
  }

  const parsed = url.parse(req.url, true);

  // Only proxy the FRED observations endpoint path
  if (!parsed.pathname || !parsed.pathname.startsWith('/fred/')) {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ error: 'Not found' }));
  }

  const targetPath = parsed.path; // includes query
  const options = {
    hostname: TARGET_HOST,
    path: targetPath,
    method: 'GET',
    headers: {
      'User-Agent': 'dev-fred-proxy/1.0',
      'Accept': 'application/json',
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    // Pipe status and body
    res.writeHead(proxyRes.statusCode || 500, {
      'Content-Type': proxyRes.headers['content-type'] || 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Bad gateway', detail: err.message }));
  });

  proxyReq.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[fred-proxy] listening on http://127.0.0.1:${PORT}`);
  console.log(`[fred-proxy] forwarding to https://${TARGET_HOST}`);
  console.log('[fred-proxy] example: http://127.0.0.1:' + PORT + '/fred/series/observations?series_id=SOFR&file_type=json');
});

