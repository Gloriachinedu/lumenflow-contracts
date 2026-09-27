#!/usr/bin/env node
/**
 * tests/playwright/server.js
 *
 * Lightweight static file server used by the Playwright web server hook.
 * Serves files from the repository root so tests can load frontend pages via
 * paths like /frontend/history.html without any build step.
 *
 * Usage (called automatically by playwright.config.js webServer):
 *   node tests/playwright/server.js
 *
 * The server listens on PORT (default 4444) and binds to 127.0.0.1 only.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.env.PORT || '4444', 10);
const ROOT = path.resolve(__dirname, '../..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ts': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  const reqUrl = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = reqUrl.pathname === '/' ? '/frontend/index.html' : reqUrl.pathname;
  const filePath = path.join(ROOT, pathname);

  // Security: prevent path traversal outside the repo root.
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + pathname);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Static server listening on http://127.0.0.1:${PORT}`);
});

// Handle clean shutdown.
process.on('SIGTERM', () => server.close());
process.on('SIGINT', () => server.close());
