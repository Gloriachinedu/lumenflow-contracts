/**
 * CJS smoke test — verifies the CJS build can be required in a bare Node.js
 * CJS script without bundler involvement.
 *
 * Run after `npm run build`:
 *   node sdk/scripts/smoke-test-cjs.cjs
 *
 * Issue #1526
 */
'use strict';

const path = require('path');
const distCjs = path.resolve(__dirname, '..', 'dist', 'index.cjs');

let sdk;
try {
  sdk = require(distCjs);
} catch (err) {
  console.error(`[smoke-test-cjs] FAIL: could not require ${distCjs}`);
  console.error(err.message);
  process.exit(1);
}

const exports = Object.keys(sdk);
if (exports.length === 0) {
  console.error('[smoke-test-cjs] FAIL: dist/index.cjs has no exports');
  process.exit(1);
}

console.log(`[smoke-test-cjs] PASS — ${exports.length} export(s): ${exports.slice(0, 5).join(', ')}…`);
