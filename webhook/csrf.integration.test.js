'use strict';

const { createServer } = require('./server');
const fetch = require('node-fetch');

let server;
let baseUrl;

beforeAll(async () => {
  server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

describe('CSRF protection integration', () => {
  test('rejects state-changing request without CSRF token (403)', async () => {
    const res = await fetch(`${baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['test'] }),
    });
    expect(res.status).toBe(403);
  });

  test('accepts state-changing request with valid CSRF token (2xx)', async () => {
    const tokenRes = await fetch(`${baseUrl}/csrf-token`, { method: 'GET' });
    expect(tokenRes.status).toBe(200);

    const setCookie = tokenRes.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    expect(setCookie).toMatch(/SameSite=Strict/i);

    const body = await tokenRes.json();
    const token = body.csrfToken || body.token;
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const cookiePair = setCookie.split(';')[0].trim();

    const res = await fetch(`${baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': token,
        Cookie: cookiePair,
      },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['test'] }),
    });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  test('rejects state-changing request with mismatched CSRF token (403)', async () => {
    const tokenRes = await fetch(`${baseUrl}/csrf-token`, { method: 'GET' });
    expect(tokenRes.status).toBe(200);

    const setCookie = tokenRes.headers.get('set-cookie');
    expect(setCookie).toBeTruthy();
    const cookiePair = setCookie.split(';')[0].trim();

    const res = await fetch(`${baseUrl}/api/webhooks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'mismatched-token-value',
        Cookie: cookiePair,
      },
      body: JSON.stringify({ url: 'https://example.com/hook', events: ['test'] }),
    });
    expect(res.status).toBe(403);
  });
});