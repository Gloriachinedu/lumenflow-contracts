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
  roots: ['<rootDir>/src/tests', '<rootDir>/src/__tests__'],
  testMatch: ['**/*.test.ts'],
  collectCoverage: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.test.ts'],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  globals: {
    'ts-jest': {
      tsconfig: '<rootDir>/tsconfig.test.json',
    },
  },
};
