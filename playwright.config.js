module.exports = {
  testDir: './tests',
  timeout: 30000,
  use: {
    headless: true,
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
  },
};
