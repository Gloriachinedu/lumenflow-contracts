const { test, expect } = require('@playwright/test');

function createServer() {
  const http = require('http');
  const fs = require('fs');
  const path = require('path');
  const root = process.cwd();
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const requestedPath = requestUrl.pathname === '/' ? '/frontend/receipt.html' : requestUrl.pathname;
    const filePath = path.join(root, requestedPath);
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath).toLowerCase();
      let contentType = 'text/html; charset=utf-8';
      if (ext === '.js') {
        contentType = 'application/javascript; charset=utf-8';
      } else if (ext === '.css') {
        contentType = 'text/css; charset=utf-8';
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
}

test('renders mobile-friendly receipt layout and handles missing receipts', async ({ page }) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await page.goto(`http://127.0.0.1:${port}/frontend/receipt.html?orderId=NOT_FOUND`);
    await expect(page.locator('#not-found')).toBeVisible();
    await expect(page.locator('#missing-id')).toContainText('NOT_FOUND');

    await page.goto(`http://127.0.0.1:${port}/frontend/receipt.html?orderId=ORDER_001`);
    await expect(page.locator('#receipt-content')).toBeVisible();
    await expect(page.locator('.receipt')).toBeVisible();
    await expect(page.locator('.actions .btn')).toHaveCount(2);
  } finally {
    server.close();
  }
});
