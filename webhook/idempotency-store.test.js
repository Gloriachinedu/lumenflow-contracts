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

/**
 * Minimal in-process Redis stub that satisfies the ioredis surface area used.
 * Honours TTL/expiry so tests can simulate the idempotency window elapsing
 * without a live Redis instance.
 */
class RedisStub {
  constructor() {
    // key -> { value, expiresAt } (expiresAt === null means no expiry)
    this._data = new Map();
  }

  _isExpired(entry) {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  _get(key) {
    const entry = this._data.get(key);
    if (!entry) return undefined;
    if (this._isExpired(entry)) {
      this._data.delete(key);
      return undefined;
    }
    return entry;
  }

  async exists(key) {
    return this._get(key) ? 1 : 0;
  }

  async set(key, value, ...args) {
    // Support both `set(key, value)` and `set(key, value, 'EX', ttl, 'NX')`.
    let ttlSeconds = null;
    let nx = false;
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (typeof arg === 'string' && arg.toUpperCase() === 'EX') {
        ttlSeconds = Number(args[i + 1]);
        i += 1;
      } else if (typeof arg === 'string' && arg.toUpperCase() === 'NX') {
        nx = true;
      }
    }

    if (nx && this._get(key)) {
      return null;
    }

    this._data.set(key, {
      value,
      expiresAt: ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : null,
    });
    return 'OK';
  }

  async setnx(key, value) {
    if (this._get(key)) {
      return 0;
    }
    this._data.set(key, { value, expiresAt: null });
    return 1;
  }

  async get(key) {
    const entry = this._get(key);
    return entry ? entry.value : null;
  }

  async keys(pattern) {
    const prefix = pattern.replace('*', '');
    return [...this._data.keys()].filter((k) => {
      const entry = this._get(k);
      return entry !== undefined && k.startsWith(prefix);
    });
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

// ---------------------------------------------------------------------------
// RedisIdempotencyStore integration tests (durable-store semantics)
// ---------------------------------------------------------------------------

describe('RedisIdempotencyStore integration', () => {
  let redis;
  let store;

  beforeEach(() => {
    redis = new RedisStub();
    store = new RedisIdempotencyStore(redis, { ttlSeconds: 60 });
  });

  test('duplicate submission within the window returns the original response', async () => {
    const token = 'pay-tok-within';
    const originalResponse = { status: 'ok', paymentId: 'PAY_001' };

    // First submission: not a duplicate, stores the response.
    expect(await store.has(token)).toBe(false);
    await store.add(token, originalResponse);

    // Duplicate submission within the window: detected and original response returned.
    expect(await store.has(token)).toBe(true);
    const stored = await store.get(token);
    expect(stored).toEqual(originalResponse);
  });

  test('duplicate submission after the window is treated as a new request', async () => {
    const token = 'pay-tok-after';
    const originalResponse = { status: 'ok', paymentId: 'PAY_002' };

    await store.add(token, originalResponse);
    expect(await store.has(token)).toBe(true);

    // Simulate the idempotency window elapsing by expiring the stored key.
    const key = [...redis._data.keys()][0];
    redis._data.get(key).expiresAt = Date.now() - 1;

    // After the window the key is gone, so this is a new request.
    expect(await store.has(token)).toBe(false);
    expect(await store.get(token)).toBeNull();

    // Re-submitting stores a fresh response.
    const newResponse = { status: 'ok', paymentId: 'PAY_003' };
    await store.add(token, newResponse);
    expect(await store.get(token)).toEqual(newResponse);
  });

  test('concurrent duplicate submissions result in exactly one processed request', async () => {
    const token = 'pay-tok-concurrent';
    const response = { status: 'ok', paymentId: 'PAY_004' };
    let processedCount = 0;

    // Simulates the relay handler: check-then-add guarded by NX semantics.
    const submit = async () => {
      if (await store.has(token)) {
        return store.get(token);
      }
      // Only the caller that wins the NX set performs the work.
      const won = await store.add(token, response);
      if (won) {
        processedCount += 1;
      }
      return store.get(token);
    };

    const results = await Promise.all([
      submit(),
      submit(),
      submit(),
      submit(),
      submit(),
    ]);

    expect(processedCount).toBe(1);
    for (const result of results) {
      expect(result).toEqual(response);
    }
  });
});
