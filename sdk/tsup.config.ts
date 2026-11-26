import { defineConfig } from 'tsup';

/**
 * tsup build configuration for @lumenflow/sdk
 *
 * Produces two output formats at the package root of dist/:
 *   - dist/index.mjs  — ES module build (tree-shakeable, for modern bundlers)
 *   - dist/index.cjs  — CommonJS build  (for Node.js require() and legacy tooling)
 *
 * Both formats include TypeScript declaration files:
 *   - dist/index.d.ts  — declarations for both formats (single copy)
 *
 * Issue #1526: Publish ESM and CJS dual-format builds via tsup
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist',
  /**
   * Use .mjs for ESM and .cjs for CJS so Node.js and bundlers
   * can unambiguously determine the module format without relying
   * solely on the exports map.
   */
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.mjs' : '.cjs',
    };
  },
  /**
   * Generate TypeScript declaration files (.d.ts) for both formats.
   * A single dist/index.d.ts is sufficient; the exports map points
   * both import and require conditions to the same declarations.
   */
  dts: {
    resolve: true,
  },
  /**
   * Do not bundle dependencies — consumers install them via package.json.
   * This keeps the output lean and avoids duplicate copies of stellar-sdk.
   */
  external: ['@stellar/stellar-sdk', 'tweetnacl'],
  /**
   * Minification is disabled for debuggability. Bundler-level minification
   * is expected from the consumer's build tool (Webpack, Rollup, Vite, etc.)
   */
  minify: false,
  /**
   * Generate sourcemaps for both formats to aid in debugging.
   */
  sourcemap: true,
  /**
   * Clean dist/ before each build to avoid stale artefacts.
   */
  clean: true,
  /**
   * Target ES2020 to match the tsconfig.json target and remain compatible
   * with all documented browser and Node.js targets.
   */
  target: 'es2020',
  /**
   * Treat all files in src/ as part of the SDK — no tree-shaking of internals
   * at build time; leave that to the consumer's bundler.
   */
  treeshake: false,
});
