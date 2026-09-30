import { defineConfig } from 'tsup';

/**
 * tsup build configuration for @lumenflow/sdk
 *
 * Produces two output formats:
 *   - dist/esm/  — ES module build (tree-shakeable, for modern bundlers)
 *   - dist/cjs/  — CommonJS build  (for Node.js require() and legacy tooling)
 *
 * Both formats include TypeScript declaration files (.d.ts).
 *
 * Issue #1039: Publish ESM and CJS dual-format builds
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist',
  /**
   * Output ESM to dist/esm/ and CJS to dist/cjs/ so consumers can explicitly
   * reference either format without relying solely on the exports map.
   */
  outExtension({ format }) {
    return {
      js: format === 'esm' ? '.js' : '.js',
    };
  },
  /**
   * Generate TypeScript declaration files (.d.ts) for both formats.
   * The declarations are placed alongside their respective JS outputs.
   */
  dts: true,
  /**
   * Split output into separate directories per format.
   */
  esbuildOptions(options, context) {
    if (context.format === 'esm') {
      options.outdir = 'dist/esm';
    } else {
      options.outdir = 'dist/cjs';
    }
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
