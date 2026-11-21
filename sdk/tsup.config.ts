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
   *
   * Issue #1114: declarationMap:true causes tsup to also emit .d.ts.map files
   * so that IDE 'Go to Definition' navigates to the original .ts source rather
   * than the compiled .d.ts stub.
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
   * Issue #1619: Enable code splitting so dynamically imported modules
   * (e.g. the lazy-loaded contract wrapper) are emitted as separate chunks
   * instead of being inlined into the entry bundle. This keeps the initial
   * SDK payload small; the contract wrapper chunk is fetched on first use.
   *
   * Code splitting is only supported for the ESM output; the CJS build
   * inlines dynamic imports (Node.js require() consumers are unaffected).
   */
  splitting: true,
  /**
   * Preserve dynamic import() calls in the output so bundlers/consumers can
   * defer loading the contract wrapper chunk until the first RPC call.
   */
  esbuildOptions(options, context) {
    if (context.format === 'esm') {
      options.outdir = 'dist/esm';
      options.splitting = true;
    } else {
      options.outdir = 'dist/cjs';
      options.splitting = false;
    }
  },
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
