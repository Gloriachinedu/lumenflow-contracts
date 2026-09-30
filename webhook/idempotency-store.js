/**
 * idempotency-store.js
 *
 * Pluggable idempotency store for webhook event delivery.
 *
 * The default implementation is an in-memory store suitable for
 * development and testing.  For production, swap it with the
 * RedisIdempotencyStore or implement the IdempotencyStore interface
 * backed by any persistent database.
 *
 * Interface contract
 * ------------------
 * Every store implementation must expose:
 *   async has(token: string): Promise<boolean>
 *   async add(token: string, meta?: object): Promise<void>
 *   async size(): Promise<number>          // optional, for observability
 *
 * Usage
 * -----
 *   const { MemoryIdempotencyStore } = require('./idempotency-store');
 *   const store = new MemoryIdempotencyStore();
 *   if (await store.has(pagingToken)) return; // already processed
 *   await store.add(pagingToken, { processedAt: new Date() });
 */

'use strict';

// ---------------------------------------------------------------------------
// In-memory store (development / testing)
// ---------------------------------------------------------------------------

class MemoryIdempotencyStore {
  constructor() {
    /** @type {Map<string, { processedAt: Date, meta: object }>} */
    this._records = new Map();
  }

  /**
   * Returns true if the token has already been processed.
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  async has(token) {
    return this._records.has(token);
  }

  /**
   * Records a token as processed.
   * @param {string} token
   * @param {object} [meta={}]
   * @returns {Promise<void>}
   */
  async add(token, meta = {}) {
    this._records.set(token, { processedAt: new Date(), meta });
  }

  /**
   * Returns the number of stored tokens.
   * @returns {Promise<number>}
   */
  async size() {
    return this._records.size;
  }
}

// ---------------------------------------------------------------------------
// Redis store (production-grade, requires 'ioredis' peer dependency)
// ---------------------------------------------------------------------------

/**
 * A Redis-backed idempotency store.
 *
 * Tokens are stored as Redis keys with an optional TTL so that the
 * store does not grow without bound in long-running deployments.
 *
 * @example
 *   const Redis = require('ioredis');
 *   const { RedisIdempotencyStore } = require('./idempotency-store');
 *   const store = new RedisIdempotencyStore(new Redis(), { ttlSeconds: 86400 * 7 });
 */
class RedisIdempotencyStore {
  /**
   * @param {object} redisClient  An ioredis (or compatible) client instance.
   * @param {object} [options]
   * @param {string} [options.keyPrefix='lumenflow:webhook:seen:']
   * @param {number} [options.ttlSeconds=604800]  Default: 7 days.
   */
  constructor(redisClient, options = {}) {
    this._redis = redisClient;
    this._prefix = options.keyPrefix || 'lumenflow:webhook:seen:';
    this._ttl = options.ttlSeconds !== undefined ? options.ttlSeconds : 60 * 60 * 24 * 7;
  }

  /** @param {string} token */
  _key(token) {
    return `${this._prefix}${token}`;
  }

  /**
   * Returns true if the token has already been processed.
   * @param {string} token
   * @returns {Promise<boolean>}
   */
  async has(token) {
    const result = await this._redis.exists(this._key(token));
    return result === 1;
  }

  /**
   * Records a token as processed (atomic SET NX with TTL).
   * @param {string} token
   * @param {object} [meta={}]
   * @returns {Promise<void>}
   */
  async add(token, meta = {}) {
    const value = JSON.stringify({ processedAt: new Date().toISOString(), meta });
    if (this._ttl > 0) {
      await this._redis.set(this._key(token), value, 'EX', this._ttl, 'NX');
    } else {
      await this._redis.setnx(this._key(token), value);
    }
  }

  /**
   * Returns the approximate count of stored tokens matching the prefix.
   * @returns {Promise<number>}
   */
  async size() {
    const keys = await this._redis.keys(`${this._prefix}*`);
    return keys.length;
  }
}

module.exports = { MemoryIdempotencyStore, RedisIdempotencyStore };
