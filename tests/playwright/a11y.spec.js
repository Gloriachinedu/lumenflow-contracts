/**
 * Accessibility audit spec — Issue #630
 *
 * Runs @axe-core/playwright against every frontend page after render.
 * Violations with impact "critical" or "serious" fail the test.
 * Known accepted violations are listed in a11y-exceptions.json.
 */

const { test, expect } = require('@playwright/test');
const { checkA11y, injectAxe } = require('@axe-core/playwright');
const path = require('path');
const http = require('http');
const fs = require('fs');

// Load known exceptions so accepted violations don't block CI
const exceptionsPath = path.join(__dirname, 'a11y-exceptions.json');
const exceptions = JSON.parse(fs.readFileSync(exceptionsPath, 'utf8'));
const acceptedRules = exceptions.exceptions.map(e => e.ruleId);

/**
 * Minimal static HTTP server for serving the frontend directory.
 * Playwright's page.goto requires an HTTP origin (not file://).
 */
function createServer() {
  const root = path.resolve(process.cwd());
  return http.createServer((req, res) => {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const requestedPath =
      requestUrl.pathname === '/' ? '/frontend/history.html' : requestUrl.pathname;
    const filePath = path.join(root, requestedPath);

    // Path traversal guard
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }

    // Determine content type
    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
    };
    const contentType = contentTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
}

/** axe rules to skip — only critical/serious violations block CI. */
const AXE_OPTIONS = {
  runOnly: {
    type: 'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'],
  },
  rules: {
    // Suppress any rules listed in a11y-exceptions.json
    ...Object.fromEntries(acceptedRules.map(id => [id, { enabled: false }])),
  },
};

/**
 * Assert that a page has no critical or serious violations.
 * Violations are reported with node selector, impact level, and help URL.
 */
async function assertNoViolations(page) {
  await injectAxe(page);
  const results = await page.evaluate(async (opts) => {
    // eslint-disable-next-line no-undef
    return await axe.run(opts);
  }, AXE_OPTIONS);

  // Filter to critical and serious only
  const blocking = results.violations.filter(v =>
    v.impact === 'critical' || v.impact === 'serious'
  );

  if (blocking.length === 0) return;

  // Build a human-readable report
  const report = blocking
    .map(v => {
      const nodes = v.nodes
        .map(n => `    • ${n.target.join(', ')}`)
        .join('\n');
      return `[${v.impact.toUpperCase()}] ${v.id}: ${v.description}\n  Help: ${v.helpUrl}\n  Nodes:\n${nodes}`;
    })
    .join('\n\n');

  throw new Error(
    `Found ${blocking.length} critical/serious accessibility violation(s):\n\n${report}`
  );
}

// ── Test suite ──────────────────────────────────────────────────────────────

let server;
let port;

test.beforeAll(async () => {
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

test.afterAll(() => {
  server.close();
});

test('history.html has no critical/serious accessibility violations', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/frontend/history.html`);
  // Wait for the page to finish rendering
  await page.waitForLoadState('networkidle');
  await assertNoViolations(page);
});

test('receipt.html has no critical/serious accessibility violations', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/frontend/receipt.html?orderId=ORDER_001`);
  await page.waitForLoadState('networkidle');
  await assertNoViolations(page);
});

test('multisig.html has no critical/serious accessibility violations', async ({ page }) => {
  await page.goto(`http://127.0.0.1:${port}/frontend/multisig.html`);
  await page.waitForLoadState('networkidle');
  await assertNoViolations(page);
});
