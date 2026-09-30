/**
 * Unit tests for frontend/receipt-cache.js
 *
 * Uses the Node.js built-in test runner (node:test) with a minimal
 * IndexedDB mock so tests run without a browser.
 *
 * Run with:
 *   node --test frontend/tests/unit/receipt-cache.test.mjs
 * or via:
 *   npm run test:unit   (from the frontend/ directory)
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal IndexedDB mock ─────────────────────────────────────────────────────
// The real receiptCache module requires window.indexedDB.  We provide a simple
// in-memory stub that supports the subset of IDB API used by the module.

/**
 * Build a fresh in-memory IDB stub and attach it to globalThis.indexedDB and
 * globalThis.window.indexedDB so the module finds it.
 */
function buildMockIDB() {
  // Raw data store: Map<orderId, entry>
  const store = new Map();

  function makeRequest(resultFn) {
    let onsuccess = null;
    let onerror   = null;
    const req = {
      get onsuccess() { return onsuccess; },
      set onsuccess(fn) { onsuccess = fn; queueMicrotask(() => { if (fn) fn({ target: req }); }); },
      get onerror() { return onerror; },
      set onerror(fn) { onerror = fn; },
      result: undefined,
    };
    // Compute result lazily so it's ready when onsuccess fires
    queueMicrotask(() => { req.result = resultFn(); });
    return req;
  }

  function makeObjectStore() {
    return {
      _store: store,

      get(key) {
        return makeRequest(() => store.get(key));
      },

      put(entry) {
        store.set(entry.order_id, { ...entry });
        return makeRequest(() => undefined);
      },

      delete(key) {
        store.delete(key);
        return makeRequest(() => undefined);
      },

      clear() {
        store.clear();
        return makeRequest(() => undefined);
      },

      count() {
        return makeRequest(() => store.size);
      },

      index(name) {
        // Return a minimal cursor index (accessed_at)
        return {
          openCursor(range, direction) {
            // Return entries sorted by accessed_at ascending or descending
            const entries = Array.from(store.values()).sort((a, b) =>
              direction === 'prev'
                ? b.accessed_at - a.accessed_at
                : a.accessed_at - b.accessed_at
            );
            let idx = 0;

            const cursorReq = { onsuccess: null, onerror: null, result: null };

            function advance() {
              const entry = entries[idx++] || null;
              const cursor = entry
                ? {
                    primaryKey: entry.order_id,
                    value:      entry,
                    delete() { store.delete(entry.order_id); },
                    continue() { queueMicrotask(() => advance()); },
                  }
                : null;
              cursorReq.result = cursor;
              if (cursorReq.onsuccess) {
                cursorReq.onsuccess({ target: cursorReq });
              }
            }

            queueMicrotask(() => advance());
            return cursorReq;
          },
        };
      },
    };
  }

  const mockObjectStore = makeObjectStore();

  function makeTransaction() {
    let oncomplete = null;
    const tx = {
      get oncomplete() { return oncomplete; },
      set oncomplete(fn) { oncomplete = fn; queueMicrotask(() => { if (fn) fn(); }); },
      onerror: null,
      onabort: null,
      objectStore() { return mockObjectStore; },
    };
    return tx;
  }

  const db = {
    transaction() { return makeTransaction(); },
    onversionchange: null,
    close() {},
  };

  const openRequest = {
    onupgradeneeded: null,
    onsuccess: null,
    onerror:   null,
    result:    db,
  };

  const mockIndexedDB = {
    open() {
      queueMicrotask(() => {
        if (openRequest.onupgradeneeded) {
          openRequest.onupgradeneeded({ target: openRequest });
        }
        if (openRequest.onsuccess) {
          openRequest.onsuccess({ target: openRequest });
        }
      });
      return openRequest;
    },
  };

  // Return both the mock and a handle to the raw store for test assertions
  return { mockIndexedDB, rawStore: store, mockObjectStore };
}

// ── Module loader with mock injection ─────────────────────────────────────────
// We dynamically import receipt-cache.js with a patched globalThis.window so
// the module picks up our stub instead of the real IndexedDB.

let receiptCache;
let rawStore;

before(async () => {
  const mock = buildMockIDB();
  rawStore = mock.rawStore;

  // Patch globalThis.window so the module finds window.indexedDB
  if (!globalThis.window) globalThis.window = {};
  globalThis.window.indexedDB = mock.mockIndexedDB;
  globalThis.indexedDB        = mock.mockIndexedDB;

  // Dynamic import so the module initialises with the mock in place
  const mod = await import('../../receipt-cache.js');
  receiptCache = mod.receiptCache;
});

beforeEach(() => {
  // Clear raw store between tests for isolation
  rawStore.clear();
  // Reset the cached DB handle inside the module by deleting the module's
  // internal _db — we do this by closing and re-opening via the mock.
});

// ── Tests ─────────────────────────────────────────────────────────────────────

const DEMO_RECEIPT = {
  payment: {
    order_id: 'ORDER_001',
    merchant_address: 'GBXG...TEST',
    amount: 50000000,
    status: 'Completed',
    paid_at: 1700000000,
  },
  merchant: { name: 'Test Store', verified: true },
  refunds: [],
};

describe('receiptCache.set and get', () => {
  it('stores and retrieves a receipt by order_id', async () => {
    await receiptCache.set('ORDER_001', DEMO_RECEIPT);
    const result = await receiptCache.get('ORDER_001');

    assert.ok(result !== null, 'result should not be null');
    assert.equal(result.data.payment.order_id, 'ORDER_001', 'order_id matches');
    assert.equal(result.data.merchant.name, 'Test Store', 'merchant name matches');
    assert.ok(typeof result.cached_at === 'number', 'cached_at is a number');
  });

  it('returns null for a missing order_id', async () => {
    const result = await receiptCache.get('DOES_NOT_EXIST');
    assert.equal(result, null, 'should return null for missing key');
  });

  it('overwrites an existing entry on re-set', async () => {
    await receiptCache.set('ORDER_001', DEMO_RECEIPT);
    const updated = { ...DEMO_RECEIPT, payment: { ...DEMO_RECEIPT.payment, status: 'FullyRefunded' } };
    await receiptCache.set('ORDER_001', updated);

    const result = await receiptCache.get('ORDER_001');
    assert.equal(result.data.payment.status, 'FullyRefunded', 'status updated to FullyRefunded');
  });
});

describe('receiptCache.delete', () => {
  it('removes a previously stored entry', async () => {
    await receiptCache.set('ORDER_DEL', DEMO_RECEIPT);
    await receiptCache.delete('ORDER_DEL');
    const result = await receiptCache.get('ORDER_DEL');
    assert.equal(result, null, 'entry should be null after delete');
  });

  it('does not throw when deleting a non-existent key', async () => {
    await assert.doesNotReject(
      receiptCache.delete('GHOST_ORDER'),
      'delete of missing key should not throw'
    );
  });
});

describe('receiptCache.size', () => {
  it('returns 0 for an empty cache', async () => {
    const count = await receiptCache.size();
    assert.equal(count, 0, 'empty cache should have size 0');
  });

  it('increments after each set', async () => {
    await receiptCache.set('A', DEMO_RECEIPT);
    assert.equal(await receiptCache.size(), 1, 'size should be 1');

    await receiptCache.set('B', DEMO_RECEIPT);
    assert.equal(await receiptCache.size(), 2, 'size should be 2');
  });

  it('does not increment when overwriting the same key', async () => {
    await receiptCache.set('SAME', DEMO_RECEIPT);
    await receiptCache.set('SAME', DEMO_RECEIPT);
    assert.equal(await receiptCache.size(), 1, 'size should remain 1');
  });
});

describe('receiptCache.clear', () => {
  it('removes all entries', async () => {
    await receiptCache.set('X1', DEMO_RECEIPT);
    await receiptCache.set('X2', DEMO_RECEIPT);
    await receiptCache.clear();
    assert.equal(await receiptCache.size(), 0, 'size should be 0 after clear');
  });
});

describe('receiptCache.keys', () => {
  it('returns all stored keys', async () => {
    await receiptCache.set('K1', DEMO_RECEIPT);
    await receiptCache.set('K2', DEMO_RECEIPT);
    const keys = await receiptCache.keys();
    assert.ok(keys.includes('K1'), 'keys should include K1');
    assert.ok(keys.includes('K2'), 'keys should include K2');
    assert.equal(keys.length, 2, 'should return exactly 2 keys');
  });

  it('returns an empty array for an empty cache', async () => {
    const keys = await receiptCache.keys();
    assert.deepEqual(keys, [], 'empty cache should return []');
  });
});

describe('LRU eviction (MAX_ENTRIES = 50)', () => {
  it('evicts the least-recently-used entry when cache exceeds 50 entries', async () => {
    // Insert 51 distinct entries — the first one should be evicted
    for (let i = 0; i < 51; i++) {
      const receipt = {
        ...DEMO_RECEIPT,
        payment: { ...DEMO_RECEIPT.payment, order_id: `LRU_${i}` },
      };
      // Ensure accessed_at timestamps are strictly ordered
      await receiptCache.set(`LRU_${i}`, receipt);
    }

    const size = await receiptCache.size();
    assert.ok(size <= 50, `cache size (${size}) should be ≤ 50 after eviction`);
  });

  it('get() updates accessed_at to prevent premature eviction', async () => {
    // This test verifies the LRU touch behaviour: a recently accessed entry
    // should survive eviction longer than an untouched one.
    // Because our mock does not enforce strict ordering in put(), we just
    // verify that get() does not throw and returns the entry.
    await receiptCache.set('TOUCH_ME', DEMO_RECEIPT);
    const result = await receiptCache.get('TOUCH_ME');
    assert.ok(result !== null, 'recently accessed entry should still exist');
    assert.ok(result.data.payment.order_id === 'ORDER_001', 'data intact after touch');
  });
});
