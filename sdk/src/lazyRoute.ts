/**
 * LumenFlow SDK — Route-level lazy loading utilities for dashboard bundle optimisation.
 *
 * The LumenFlow merchant dashboard ships multiple heavyweight views (payment
 * history, refund management, webhook status, analytics).  Loading all of them
 * eagerly inflates the initial bundle and hurts Time-to-Interactive.
 *
 * This module provides framework-agnostic helpers for declaring route-level
 * lazy boundaries, a {@link RouteManifest} that centralises the split points,
 * and a {@link RoutePreloader} that warms up chunks on user-intent signals
 * (hover, focus) before navigation occurs — eliminating the perceived latency
 * of a code-split route.
 *
 * Framework integration
 * ---------------------
 * The helpers are designed to slot into React Router / TanStack Router lazy
 * routes or any bundler that understands dynamic `import()`.  They do not
 * depend on React directly; the `loader` type parameter is generic.
 *
 * Closes #799.
 */

/** A function that returns a dynamic import promise. */
export type ChunkLoader<T = unknown> = () => Promise<T>;

/** Metadata for a single dashboard route. */
export interface RouteDefinition<T = unknown> {
  /** URL path pattern, e.g. `/dashboard/payments`. */
  path: string;
  /** Human-readable route name for debugging / analytics. */
  name: string;
  /**
   * Dynamic import factory.  Bundlers (webpack, Vite, Rollup) split at the
   * `import()` call-site, so this must be an inline arrow function — do NOT
   * assign the result to a variable before passing.
   *
   * @example
   * ```ts
   * loader: () => import('./views/PaymentsView'),
   * ```
   */
  loader: ChunkLoader<T>;
  /**
   * Intent-based preload triggers.  The {@link RoutePreloader} listens for
   * these signals and warms the chunk before the user actually navigates.
   * Default: `['hover']`.
   */
  preloadOn?: Array<'hover' | 'focus' | 'visible'>;
}

/** A map of route key → {@link RouteDefinition}. */
export type RouteManifest<T = unknown> = Record<string, RouteDefinition<T>>;

/**
 * Declare the dashboard route manifest.  Each entry describes a split point;
 * the bundler creates a separate chunk for each unique `loader` function.
 *
 * @example
 * ```ts
 * export const DASHBOARD_ROUTES = defineRouteManifest({
 *   payments:  { path: '/dashboard/payments',  name: 'Payments',  loader: () => import('./views/PaymentsView')  },
 *   refunds:   { path: '/dashboard/refunds',   name: 'Refunds',   loader: () => import('./views/RefundsView')   },
 *   webhooks:  { path: '/dashboard/webhooks',  name: 'Webhooks',  loader: () => import('./views/WebhooksView')  },
 *   analytics: { path: '/dashboard/analytics', name: 'Analytics', loader: () => import('./views/AnalyticsView') },
 * });
 * ```
 */
export function defineRouteManifest<T>(manifest: RouteManifest<T>): RouteManifest<T> {
  return manifest;
}

/** State of a cached chunk load. */
type ChunkState<T> =
  | { status: 'idle' }
  | { status: 'loading'; promise: Promise<T> }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: unknown };

/**
 * Manages intent-based preloading for code-split routes.
 *
 * Register routes once, then call {@link RoutePreloader.preload} on hover/focus
 * events.  The chunk is only fetched once regardless of how many times
 * `preload` is called — subsequent calls return the cached promise.
 */
export class RoutePreloader<T = unknown> {
  private readonly cache = new Map<string, ChunkState<T>>();
  private readonly manifest: RouteManifest<T>;

  constructor(manifest: RouteManifest<T>) {
    this.manifest = manifest;
  }

  /**
   * Begin loading the chunk for `routeKey` if it hasn't been loaded yet.
   * Safe to call multiple times — returns the cached promise on repeat calls.
   *
   * @throws `RangeError` if `routeKey` is not in the manifest.
   */
  preload(routeKey: string): Promise<T> {
    const route = this.manifest[routeKey];
    if (!route) {
      throw new RangeError(`Unknown route key: "${routeKey}". Check your RouteManifest.`);
    }

    const existing = this.cache.get(routeKey);
    if (existing?.status === 'loading') return existing.promise;
    if (existing?.status === 'ready') return Promise.resolve(existing.value);
    if (existing?.status === 'error') return Promise.reject(existing.error);

    const promise = route.loader().then(
      (value) => {
        this.cache.set(routeKey, { status: 'ready', value });
        return value;
      },
      (error) => {
        this.cache.set(routeKey, { status: 'error', error });
        throw error;
      },
    );

    this.cache.set(routeKey, { status: 'loading', promise });
    return promise;
  }

  /**
   * Load and return the chunk, throwing if it fails.
   * Equivalent to `preload` but semantically signals "navigate now".
   */
  load(routeKey: string): Promise<T> {
    return this.preload(routeKey);
  }

  /** Current load state for a route key. `'idle'` if not yet requested. */
  getState(routeKey: string): ChunkState<T>['status'] {
    return this.cache.get(routeKey)?.status ?? 'idle';
  }

  /**
   * Preload all routes that declare a given intent trigger.
   * Useful for preloading `visible` routes when a layout renders.
   */
  preloadByIntent(intent: 'hover' | 'focus' | 'visible'): void {
    for (const [key, route] of Object.entries(this.manifest)) {
      const triggers = route.preloadOn ?? ['hover'];
      if (triggers.includes(intent)) {
        this.preload(key).catch(() => {
          // Silently swallow preload errors — they will surface on actual navigation.
        });
      }
    }
  }

  /** Reset cache (test helper). */
  _reset(): void {
    this.cache.clear();
  }
}
