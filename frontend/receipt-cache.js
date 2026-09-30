/**
 * LumenFlow Receipt Cache — IndexedDB-backed LRU store
 *
 * Stores up to MAX_ENTRIES recently viewed payment receipts in IndexedDB,
 * keyed by order_id.  When the store exceeds MAX_ENTRIES the least-recently-
 * used entry is evicted automatically.
 *
 * All operations are fully async and non-blocking on the main thread.
 *
 * Public API:
 *   receiptCache.get(orderId)            → Promise<object|null>
 *   receiptCache.set(orderId, data)      → Promise<void>
 *   receiptCache.delete(orderId)         → Promise<void>
 *   receiptCache.clear()                 → Promise<void>
 *   receiptCache.size()                  → Promise<number>
 *   receiptCache.keys()                  → Promise<string[]>
 *
 * Cache entry shape stored in IndexedDB:
 *   {
 *     order_id:   string,   // primary key
 *     data:       object,   // { payment, merchant, refunds }
 *     accessed_at: number,  // Date.now() ms — used for LRU eviction
 *     cached_at:   number,  // Date.now() ms — shown in the stale banner
 *   }
 */

const DB_NAME    = 'lumenflow-receipts';
const DB_VERSION = 1;
const STORE_NAME = 'receipts';
const MAX_ENTRIES = 50;

// ── Internal DB handle ────────────────────────────────────────────────────────

let _db = null;

/**
 * Open (or create) the IndexedDB database.
 * Returns a promise that resolves with the IDBDatabase instance.
 * Subsequent calls return the already-open handle.
 *
 * @returns {Promise<IDBDatabase>}
 */
function openDB() {
  if (_db) return Promise.resolve(_db);

  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this browser.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'order_id' });
        // Index on accessed_at for efficient LRU queries
        store.createIndex('accessed_at', 'accessed_at', { unique: false });
      }
    };

    request.onsuccess = (event) => {
      _db = event.target.result;

      // Handle unexpected version upgrades and connection issues
      _db.onversionchange = () => {
        _db.close();
        _db = null;
      };

      resolve(_db);
    };

    request.onerror = () => reject(request.error);
  });
}

/**
 * Wrap an IDBTransaction in a Promise so callers can await it.
 * @param {IDBTransaction} tx
 * @returns {Promise<void>}
 */
function awaitTx(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(new Error('IDB transaction aborted'));
  });
}

/**
 * Wrap an IDBRequest in a Promise.
 * @template T
 * @param {IDBRequest<T>} req
 * @returns {Promise<T>}
 */
function awaitReq(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── LRU eviction ─────────────────────────────────────────────────────────────

/**
 * Evict the least-recently-used entries until the store is at most MAX_ENTRIES.
 * Uses the accessed_at index to find the oldest entries efficiently.
 *
 * @param {IDBObjectStore} store - open readwrite object store
 * @returns {Promise<void>}
 */
async function evictIfNeeded(store) {
  const countReq = store.count();
  const count = await awaitReq(countReq);

  if (count <= MAX_ENTRIES) return;

  const toEvict = count - MAX_ENTRIES;
  const index   = store.index('accessed_at');

  // Open a cursor on the accessed_at index in ascending order (oldest first)
  await new Promise((resolve, reject) => {
    const cursorReq = index.openCursor(null, 'next');
    let evicted = 0;

    cursorReq.onsuccess = (event) => {
      const cursor = event.target.result;
      if (!cursor || evicted >= toEvict) {
        resolve();
        return;
      }
      cursor.delete();
      evicted++;
      cursor.continue();
    };

    cursorReq.onerror = () => reject(cursorReq.error);
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

export const receiptCache = {
  /**
   * Retrieve a receipt entry by order_id.
   * Updates accessed_at to mark it as recently used (LRU touch).
   *
   * @param {string} orderId
   * @returns {Promise<{data: object, cached_at: number}|null>}
   *   Returns the stored entry (with `data` and `cached_at`) or null if absent.
   */
  async get(orderId) {
    try {
      const db = await openDB();
      const tx    = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const entry = await awaitReq(store.get(orderId));
      if (!entry) return null;

      // Touch — update LRU timestamp without blocking the caller
      entry.accessed_at = Date.now();
      store.put(entry);

      await awaitTx(tx);
      return { data: entry.data, cached_at: entry.cached_at };
    } catch (err) {
      console.warn('[receiptCache] get failed:', err);
      return null;
    }
  },

  /**
   * Store a receipt entry for the given order_id.
   * Automatically evicts the LRU entry if the store exceeds MAX_ENTRIES.
   *
   * @param {string} orderId
   * @param {object} data   The { payment, merchant, refunds } object to cache.
   * @returns {Promise<void>}
   */
  async set(orderId, data) {
    try {
      const db    = await openDB();
      const tx    = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      const now = Date.now();
      store.put({
        order_id:    orderId,
        data:        data,
        accessed_at: now,
        cached_at:   now,
      });

      await evictIfNeeded(store);
      await awaitTx(tx);
    } catch (err) {
      console.warn('[receiptCache] set failed:', err);
    }
  },

  /**
   * Remove a single entry from the cache.
   * @param {string} orderId
   * @returns {Promise<void>}
   */
  async delete(orderId) {
    try {
      const db    = await openDB();
      const tx    = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(orderId);
      await awaitTx(tx);
    } catch (err) {
      console.warn('[receiptCache] delete failed:', err);
    }
  },

  /**
   * Clear all entries from the cache.
   * @returns {Promise<void>}
   */
  async clear() {
    try {
      const db    = await openDB();
      const tx    = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      await awaitTx(tx);
    } catch (err) {
      console.warn('[receiptCache] clear failed:', err);
    }
  },

  /**
   * Returns the current number of entries in the cache.
   * @returns {Promise<number>}
   */
  async size() {
    try {
      const db    = await openDB();
      const tx    = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      return await awaitReq(store.count());
    } catch (err) {
      console.warn('[receiptCache] size failed:', err);
      return 0;
    }
  },

  /**
   * Returns all order IDs currently in the cache, sorted by most-recently-
   * accessed first.
   * @returns {Promise<string[]>}
   */
  async keys() {
    try {
      const db    = await openDB();
      const tx    = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('accessed_at');

      return await new Promise((resolve, reject) => {
        const keys = [];
        const cursorReq = index.openCursor(null, 'prev'); // newest first

        cursorReq.onsuccess = (event) => {
          const cursor = event.target.result;
          if (!cursor) { resolve(keys); return; }
          keys.push(cursor.primaryKey);
          cursor.continue();
        };

        cursorReq.onerror = () => reject(cursorReq.error);
      });
    } catch (err) {
      console.warn('[receiptCache] keys failed:', err);
      return [];
    }
  },
};
