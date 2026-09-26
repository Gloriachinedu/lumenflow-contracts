/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Only pick up files tagged for integration
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.integration.test.ts"],
  // Longer timeout — real network calls can be slow
  testTimeout: 60000,
  // No coverage collection for integration tests (noise vs. unit suite)
  collectCoverage: false,
  globals: {
    "ts-jest": {
      tsconfig: "<rootDir>/tsconfig.json",
    },
  },
};
