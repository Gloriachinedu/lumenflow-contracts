/**
 * Tests for issue #787: Prevent duplicate payment submissions during wallet confirmation.
 *
 * Verifies that the submit, sign, and execute buttons are disabled during
 * in-flight async operations so that rapid or concurrent clicks cannot
 * dispatch more than one request to the wallet / RPC.
 */
const { test, expect } = require('@playwright/test');

function createServer() {
  const http = require('http');
  const fs   = require('fs');
  const path = require('path');
  const root = process.cwd();
  return http.createServer((req, res) => {
    const requestUrl   = new URL(req.url, 'http://127.0.0.1');
    const requestedPath = requestUrl.pathname === '/' ? '/frontend/multisig.html' : requestUrl.pathname;
    const filePath = path.join(root, requestedPath);
    if (!filePath.startsWith(root)) { res.writeHead(403); res.end('Forbidden'); return; }
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      const ext = path.extname(filePath);
      const mime = ext === '.js' ? 'application/javascript' : 'text/html';
      res.writeHead(200, { 'Content-Type': `${mime}; charset=utf-8` });
      res.end(data);
    });
  });
}

test('submit button is disabled while initiation is in-flight (duplicate guard)', async ({ page }) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await page.goto(`http://127.0.0.1:${port}/frontend/multisig.html`);

    // Fill in minimum valid form values (demo mode accepts any values)
    await page.fill('#payment-id',        'MS_TEST_001');
    await page.fill('#merchant-address',  'GDQASKOKG7RQNR24MFMDGCF5F3WKCTG5QXNLK2YGZPAEHLQZ3E7WJN4');
    await page.fill('#token-address',     'CAHNAYQIYF4TPWDX6TPMCJOFUZB3E5OEB4KQSYRM6LNOQDXLQJ5XQOO');
    await page.fill('#amount',            '1000000');
    await page.fill('.signer-input',      'GDQASKOKG7RQNR24MFMDGCF5F3WKCTG5QXNLK2YGZPAEHLQZ3E7WJN4');

    const submitBtn = page.locator('#submit-btn');

    // Click submit — in demo mode the async call resolves quickly, but we
    // immediately assert the button is disabled to confirm the guard fired.
    await submitBtn.click();

    // Button must be disabled while in-flight (aria-busy and disabled attr set)
    // This races the 600 ms demo delay, but Playwright's click is synchronous
    // so the guard fires before the awaited async call resolves.
    await expect(submitBtn).toBeDisabled();
  } finally {
    server.close();
  }
});

test('submit button is re-enabled after a failed initiation (error path)', async ({ page }) => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    await page.goto(`http://127.0.0.1:${port}/frontend/multisig.html`);

    // Inject a CONTRACT_ID so callInitiateMultisig enters the live branch,
    // which will immediately fail with "Wallet integration required." without
    // actually attempting a network call.
    await page.evaluate(() => { window.LUMENFLOW_CONTRACT_ID = 'FAKE_CONTRACT'; });
    await page.reload();

    await page.fill('#payment-id',        'MS_TEST_002');
    await page.fill('#merchant-address',  'GDQASKOKG7RQNR24MFMDGCF5F3WKCTG5QXNLK2YGZPAEHLQZ3E7WJN4');
    await page.fill('#token-address',     'CAHNAYQIYF4TPWDX6TPMCJOFUZB3E5OEB4KQSYRM6LNOQDXLQJ5XQOO');
    await page.fill('#amount',            '1000000');
    await page.fill('.signer-input',      'GDQASKOKG7RQNR24MFMDGCF5F3WKCTG5QXNLK2YGZPAEHLQZ3E7WJN4');

    const submitBtn = page.locator('#submit-btn');
    await submitBtn.click();

    // Wait for error feedback — button should be re-enabled after failure
    await expect(page.locator('#form-alert')).toBeVisible({ timeout: 5000 });
    await expect(submitBtn).not.toBeDisabled({ timeout: 5000 });
  } finally {
    server.close();
  }
});
