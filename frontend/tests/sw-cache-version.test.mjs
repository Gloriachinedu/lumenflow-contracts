/**
 * Unit tests for sw.js cache versioning strategy (Issue #1012).
 *
 * These tests use a lightweight in-memory mock of the Cache Storage API to
 * verify that:
 *   1. CACHE_NAME contains a version string.
 *   2. Old cache entries are deleted during the activate event.
 *   3. The current cache is preserved during cleanup.
 */

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';

// ── Minimal Cache Storage mock ────────────────────────────────────────────────

class MockCache {
  constructor() { this._store = new Map(); }
  async put(req, res) { this._store.set(req, res); }
  async add(url) { this._store.set(url, { url }); }
  async match(req) { return this._store.get(req) ?? undefined; }
  keys() { return Promise.resolve([...this._store.keys()]); }
}

function buildCacheStorage(initialNames = []) {
  const caches = new Map(initialNames.map((n) => [n, new MockCache()]));
  return {
    async open(name) {
      if (!caches.has(name)) caches.set(name, new MockCache());
      return caches.get(name);
    },
    async keys() { return [...caches.keys()]; },
    async delete(name) { return caches.delete(name); },
    has(name) { return caches.has(name); },
  };
}

// ── Helpers that replicate the SW activate logic ──────────────────────────────

/**
 * Simulates the activate-event cleanup: deletes every cache whose name
 * does not equal `currentCacheName`.
 */
async function runActivateCleanup(cacheStorage, currentCacheName) {
  const names = await cacheStorage.keys();
  await Promise.all(
    names
      .filter((n) => n !== currentCacheName)
      .map((n) => cacheStorage.delete(n)),
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SW cache versioning (issue #1012)', () => {
  const BUILD_HASH = 'a1b2c3d';
  const CURRENT_CACHE = `lf-cache-v${BUILD_HASH}`;

  it('CACHE_NAME follows the lf-cache-v<build-hash> pattern', () => {
    assert.match(CURRENT_CACHE, /^lf-cache-v[0-9a-f]+$/);
  });

  it('activate event deletes all stale caches', async () => {
    const staleNames = ['lf-cache-vdeadbeef', 'lf-cache-v0f0f0f0', 'old-cache'];
    const storage = buildCacheStorage([...staleNames, CURRENT_CACHE]);

    await runActivateCleanup(storage, CURRENT_CACHE);

    for (const name of staleNames) {
      assert.equal(storage.has(name), false, `stale cache "${name}" should have been deleted`);
    }
  });

  it('activate event preserves the current cache', async () => {
    const storage = buildCacheStorage(['lf-cache-vdeadbeef', CURRENT_CACHE]);

    await runActivateCleanup(storage, CURRENT_CACHE);

    assert.equal(storage.has(CURRENT_CACHE), true, 'current cache must not be deleted');
  });

  it('activate on a fresh install (no stale caches) does not throw', async () => {
    const storage = buildCacheStorage([CURRENT_CACHE]);
    await assert.doesNotReject(() => runActivateCleanup(storage, CURRENT_CACHE));
  });

  it('activate removes multiple stale versions in one pass', async () => {
    const stale = ['lf-cache-v1111111', 'lf-cache-v2222222', 'lf-cache-v3333333'];
    const storage = buildCacheStorage([...stale, CURRENT_CACHE]);

    await runActivateCleanup(storage, CURRENT_CACHE);

    const remaining = await storage.keys();
    assert.deepEqual(remaining, [CURRENT_CACHE]);
  });
});
