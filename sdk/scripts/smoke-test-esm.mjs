/**
 * ESM smoke test — verifies the ESM build can be imported in a bare Node.js
 * ESM script without bundler involvement.
 *
 * Run after `npm run build`:
 *   node sdk/scripts/smoke-test-esm.mjs
 *
 * Issue #1526
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distMjs = path.resolve(__dirname, '..', 'dist', 'index.mjs');

// Dynamic import so we get a helpful error if the file is missing
let sdk;
try {
  sdk = await import(distMjs);
} catch (err) {
  console.error(`[smoke-test-esm] FAIL: could not import ${distMjs}`);
  console.error(err.message);
  process.exit(1);
}

// The SDK must export at least one named symbol
const exports = Object.keys(sdk).filter((k) => k !== 'default');
if (exports.length === 0) {
  console.error('[smoke-test-esm] FAIL: dist/index.mjs has no named exports');
  process.exit(1);
}

console.log(`[smoke-test-esm] PASS — ${exports.length} named export(s): ${exports.slice(0, 5).join(', ')}…`);
