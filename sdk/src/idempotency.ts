/**
 * Client-side idempotency cache for LumenFlow SDK.
 *
 * Caches the result of a payment submission keyed by a caller-supplied
 * idempotency key.  A duplicate call with the same key returns the cached
 * result without issuing a new RPC request.  Cache entries expire after
 * CACHE_TTL_MS (default 5 minutes).
 *
 * Storage strategy
 * ----------------
 * When `sessionStorage` is available (browser environments) the cache is
 * persisted there so it survives soft navigation within a single tab.
 * In Node.js / test environments (where `sessionStorage` is not available)
 * an in-memory `Map` is used as a fallback.
 */

const CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes
const STORAGE_PREFIX = "lumenflow:idempotency:";

export interface CacheEntry<T> {
  /** The cached result value. */
  result: T;
  /** Unix timestamp (ms) at which this entry expires. */
  expiresAt: number;
}

// ── Storage abstraction ───────────────────────────────────────────────────────

function getSessionStorage(): Storage | null {
  try {
    if (typeof sessionStorage !== "undefined") {
      // Verify it is actually usable (Safari private mode can throw on access)
      sessionStorage.setItem("__lumenflow_test__", "1");
      sessionStorage.removeItem("__lumenflow_test__");
      return sessionStorage;
    }
  } catch {
    // fall through to in-memory fallback
  }
  return null;
}

const memoryCache = new Map<string, string>();

function storageGet(key: string): string | null {
  const storage = getSessionStorage();
  if (storage) {
    return storage.getItem(STORAGE_PREFIX + key);
  }
  return memoryCache.get(STORAGE_PREFIX + key) ?? null;
}

function storageSet(key: string, value: string): void {
  const storage = getSessionStorage();
  if (storage) {
    storage.setItem(STORAGE_PREFIX + key, value);
  } else {
    memoryCache.set(STORAGE_PREFIX + key, value);
  }
}

function storageDelete(key: string): void {
  const storage = getSessionStorage();
  if (storage) {
    storage.removeItem(STORAGE_PREFIX + key);
  } else {
    memoryCache.delete(STORAGE_PREFIX + key);
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieve a cached result for the given idempotency key.
 *
 * Returns the cached result if the entry exists and has not expired.
 * Returns `undefined` if there is no entry or the entry has expired
 * (expired entries are evicted on read).
 */
export function getCached<T>(key: string): T | undefined {
  const raw = storageGet(key);
  if (!raw) return undefined;

  let entry: CacheEntry<T>;
  try {
    entry = JSON.parse(raw) as CacheEntry<T>;
  } catch {
    // Corrupt entry — evict it
    storageDelete(key);
    return undefined;
  }

  if (Date.now() >= entry.expiresAt) {
    storageDelete(key);
    return undefined;
  }

  return entry.result;
}

/**
 * Store a result in the cache under the given idempotency key.
 * The entry expires after {@link CACHE_TTL_MS} milliseconds.
 */
export function setCached<T>(key: string, result: T): void {
  const entry: CacheEntry<T> = {
    result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };
  storageSet(key, JSON.stringify(entry));
}

/**
 * Explicitly remove an entry from the cache.
 * Useful if the caller knows a previous submission failed and wants to retry.
 */
export function evictCached(key: string): void {
  storageDelete(key);
}

/**
 * Execute `fn` with idempotency semantics:
 *
 * - If `idempotencyKey` is provided and a non-expired cached result exists,
 *   return the cached result immediately without calling `fn`.
 * - Otherwise call `fn`, cache the result (keyed by `idempotencyKey` when
 *   provided), and return the result.
 *
 * Note: `undefined` / void results are cached correctly using an internal
 * sentinel so that a void function (e.g. processPayment) is still deduplicated
 * on the second call.
 *
 * @param idempotencyKey - Optional caller-supplied key.  When omitted the
 *   function behaves as a normal call with no caching.
 * @param fn - Async factory that performs the actual RPC call.
 */

const VOID_SENTINEL = "__lumenflow_void__";

export async function withIdempotency<T>(
  idempotencyKey: string | undefined,
  fn: () => Promise<T>
): Promise<T> {
  if (!idempotencyKey) {
    return fn();
  }

  const cached = getCached<T | typeof VOID_SENTINEL>(idempotencyKey);
  if (cached !== undefined) {
    // Unwrap sentinel back to undefined for void functions
    return (cached === VOID_SENTINEL ? undefined : cached) as T;
  }

  const result = await fn();
  // Store a sentinel for void (undefined) results so we can distinguish
  // "cached undefined" from "not in cache".
  setCached<T | typeof VOID_SENTINEL>(
    idempotencyKey,
    result === undefined ? VOID_SENTINEL : result
  );
  return result;
}
