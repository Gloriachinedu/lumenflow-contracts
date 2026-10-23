/**
 * idempotency-store.test.js
 *
 * Unit tests for MemoryIdempotencyStore (and the RedisIdempotencyStore
 * contract via a lightweight stub).
 */

'use strict';

const { MemoryIdempotencyStore, RedisIdempotencyStore } = require('./idempotency-store');

// ---------------------------------------------------------------------------
// MemoryIdempotencyStore
// ---------------------------------------------------------------------------

describe('MemoryIdempotencyStore', () => {
  let store;

  beforeEach(() => {
    store = new MemoryIdempotencyStore();
  });

  test('has() returns false for unknown token', async () => {
    expect(await store.has('tok-1')).toBe(false);
  });

  test('has() returns true after add()', async () => {
    await store.add('tok-1');
    expect(await store.has('tok-1')).toBe(true);
  });

  test('add() is idempotent — calling twice does not throw', async () => {
    await store.add('tok-dup');
    await expect(store.add('tok-dup')).resolves.toBeUndefined();
    expect(await store.has('tok-dup')).toBe(true);
  });

  test('size() reflects stored token count', async () => {
    expect(await store.size()).toBe(0);
    await store.add('a');
    await store.add('b');
    expect(await store.size()).toBe(2);
  });

  test('stores metadata alongside the token', async () => {
    await store.add('tok-meta', { orderId: 'ORDER_001' });
    // has() still returns true; metadata is stored internally
    expect(await store.has('tok-meta')).toBe(true);
  });

  test('different tokens are independent', async () => {
    await store.add('tok-x');
    expect(await store.has('tok-y')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// RedisIdempotencyStore (contract tests via a stub client)
// ---------------------------------------------------------------------------

/** Minimal in-process Redis stub that satisfies the ioredis surface area used. */
class RedisStub {
  constructor() {
    this._data = new Map();
  }

  async exists(key) {
    return this._data.has(key) ? 1 : 0;
  }

  async set(key, value, _ex, _ttl, _nx) {
    // Honour NX semantics: only set if not already present.
    if (!this._data.has(key)) {
      this._data.set(key, value);
    }
  }

  async setnx(key, value) {
    if (!this._data.has(key)) {
      this._data.set(key, value);
      return 1;
    }
    return 0;
  }

  async keys(pattern) {
    const prefix = pattern.replace('*', '');
    return [...this._data.keys()].filter((k) => k.startsWith(prefix));
  }
}

describe('RedisIdempotencyStore', () => {
  let store;
  let redis;

  beforeEach(() => {
    redis = new RedisStub();
    store = new RedisIdempotencyStore(redis, { ttlSeconds: 3600 });
  });

  test('has() returns false for unknown token', async () => {
    expect(await store.has('rtok-1')).toBe(false);
  });

  test('has() returns true after add()', async () => {
    await store.add('rtok-1');
    expect(await store.has('rtok-1')).toBe(true);
  });

  test('add() is idempotent via NX semantics', async () => {
    await store.add('rtok-dup');
    await expect(store.add('rtok-dup')).resolves.toBeUndefined();
    expect(await store.has('rtok-dup')).toBe(true);
  });

  test('size() counts keys with the configured prefix', async () => {
    expect(await store.size()).toBe(0);
    await store.add('rtok-a');
    await store.add('rtok-b');
    expect(await store.size()).toBe(2);
  });

  test('uses the correct key prefix', async () => {
    const customStore = new RedisIdempotencyStore(redis, {
      keyPrefix: 'myapp:events:',
      ttlSeconds: 0,
    });
    await customStore.add('rtok-custom');
    const size = await customStore.size();
    expect(size).toBe(1);
  });
});
