/**
 * CI step: verify the package.json exports map is valid and all referenced
 * dist files exist after a build.
 *
 * Run after `npm run build`:
 *   node sdk/scripts/verify-exports-map.mjs
 *
 * Checks:
 *   - exports["."].import.default  → dist/index.mjs   (exists)
 *   - exports["."].require.default → dist/index.cjs   (exists)
 *   - exports["."].import.types    → dist/index.d.ts  (exists)
 *   - exports["."].require.types   → dist/index.d.ts  (exists)
 *
 * Issue #1526
 */
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const pkg = require(path.join(pkgRoot, 'package.json'));

let failed = false;

function check(label, relPath) {
  const abs = path.resolve(pkgRoot, relPath.replace(/^\.\//, ''));
  if (!fs.existsSync(abs)) {
    console.error(`[verify-exports-map] FAIL: ${label} → ${relPath} does not exist (${abs})`);
    failed = true;
  } else {
    console.log(`[verify-exports-map] OK  : ${label} → ${relPath}`);
  }
}

const dot = pkg.exports?.['.'];
if (!dot) {
  console.error('[verify-exports-map] FAIL: exports["."] is missing from package.json');
  process.exit(1);
}

check('import.default ', dot.import?.default);
check('import.types   ', dot.import?.types);
check('require.default', dot.require?.default);
check('require.types  ', dot.require?.types);

// Also verify the top-level "main", "module", and "types" fields
check('main            ', pkg.main);
check('module          ', pkg.module);
check('types           ', pkg.types);

if (failed) {
  console.error('\n[verify-exports-map] One or more checks failed. Run `npm run build` first.');
  process.exit(1);
}

console.log('\n[verify-exports-map] All exports-map checks passed.');
