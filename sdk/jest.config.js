/**
 * Jest configuration for @lumenflow/sdk
 *
 * Tests run against the TypeScript sources via ts-jest (using the CJS transform),
 * which matches the CJS dist output. This satisfies the acceptance criterion that
 * "existing Jest tests continue to pass against CJS build" (issue #1039).
 *
 * To run tests against the compiled CJS output directly:
 *   npm run test:cjs
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Issue #1088: `roots` previously pointed only at src/tests and
  // src/__tests__, which silently excluded every *.test.ts file living
  // directly under src/ (lazyRoute.test.ts, payments.test.ts, client.test.ts,
  // config.test.ts, etc. — about 20 files). Those tests were never executed
  // by `npm test`, so real SDK coverage was far lower than reported. Scoping
  // roots to the whole src/ directory restores discovery of all test files.
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  // Issue #1088: enforce the 90%+ line coverage target so a future PR that
  // drops coverage fails CI instead of merging silently.
  coverageThreshold: {
    global: {
      lines: 90,
      statements: 90,
      functions: 85,
      branches: 80,
    },
  },
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.test.json',
    },
  },
};
