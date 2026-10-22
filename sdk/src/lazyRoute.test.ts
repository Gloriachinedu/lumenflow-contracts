import { defineRouteManifest, RoutePreloader } from './lazyRoute';

function makeManifest() {
  return defineRouteManifest({
    payments: {
      path: '/dashboard/payments',
      name: 'Payments',
      loader: async () => ({ default: 'PaymentsView' }),
      preloadOn: ['hover'],
    },
    analytics: {
      path: '/dashboard/analytics',
      name: 'Analytics',
      loader: async () => ({ default: 'AnalyticsView' }),
      preloadOn: ['visible'],
    },
  });
}

describe('RoutePreloader', () => {
  it('loads a route chunk by key', async () => {
    const preloader = new RoutePreloader(makeManifest());
    const result = await preloader.load('payments');
    expect(result).toEqual({ default: 'PaymentsView' });
  });

  it('caches and returns the same promise on repeat calls', async () => {
    const loader = jest.fn().mockResolvedValue({ default: 'PaymentsView' });
    const manifest = defineRouteManifest({ payments: { path: '/p', name: 'P', loader } });
    const preloader = new RoutePreloader(manifest);

    const p1 = preloader.preload('payments');
    const p2 = preloader.preload('payments');
    expect(p1).toBe(p2); // same promise
    await p1;
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('returns ready immediately on subsequent preload after load', async () => {
    const preloader = new RoutePreloader(makeManifest());
    await preloader.load('payments');
    expect(preloader.getState('payments')).toBe('ready');
    const result = await preloader.preload('payments');
    expect(result).toEqual({ default: 'PaymentsView' });
  });

  it('throws RangeError for unknown route key', () => {
    const preloader = new RoutePreloader(makeManifest());
    expect(() => preloader.preload('unknown')).toThrow(RangeError);
  });

  it('marks state as error when loader rejects', async () => {
    const manifest = defineRouteManifest({
      broken: { path: '/b', name: 'B', loader: async () => { throw new Error('chunk load failed'); } },
    });
    const preloader = new RoutePreloader(manifest);
    await expect(preloader.load('broken')).rejects.toThrow('chunk load failed');
    expect(preloader.getState('broken')).toBe('error');
  });

  it('preloadByIntent only preloads matching routes', async () => {
    const paymentsLoader = jest.fn().mockResolvedValue({});
    const analyticsLoader = jest.fn().mockResolvedValue({});
    const manifest = defineRouteManifest({
      payments:  { path: '/p', name: 'P', loader: paymentsLoader,  preloadOn: ['hover'] },
      analytics: { path: '/a', name: 'A', loader: analyticsLoader, preloadOn: ['visible'] },
    });
    const preloader = new RoutePreloader(manifest);
    preloader.preloadByIntent('hover');
    await new Promise((r) => setTimeout(r, 0));
    expect(paymentsLoader).toHaveBeenCalledTimes(1);
    expect(analyticsLoader).not.toHaveBeenCalled();
  });

  it('preloadByIntent treats a route with no preloadOn as hover-only', async () => {
    const loader = jest.fn().mockResolvedValue({});
    const manifest = defineRouteManifest({ payments: { path: '/p', name: 'P', loader } });
    const preloader = new RoutePreloader(manifest);

    preloader.preloadByIntent('visible');
    await new Promise((r) => setTimeout(r, 0));
    expect(loader).not.toHaveBeenCalled();

    preloader.preloadByIntent('hover');
    await new Promise((r) => setTimeout(r, 0));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('preloadByIntent swallows a rejected loader rather than throwing', async () => {
    const manifest = defineRouteManifest({
      broken: { path: '/b', name: 'B', loader: async () => { throw new Error('boom'); } },
    });
    const preloader = new RoutePreloader(manifest);
    expect(() => preloader.preloadByIntent('hover')).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(preloader.getState('broken')).toBe('error');
  });

  it('re-rejects with the cached error on a second preload after failure', async () => {
    const manifest = defineRouteManifest({
      broken: { path: '/b', name: 'B', loader: async () => { throw new Error('chunk load failed'); } },
    });
    const preloader = new RoutePreloader(manifest);
    await expect(preloader.load('broken')).rejects.toThrow('chunk load failed');

    // Second call should reject with the cached error, not re-invoke the loader.
    await expect(preloader.preload('broken')).rejects.toThrow('chunk load failed');
  });

  it('getState returns "idle" for a route that has never been requested', () => {
    const preloader = new RoutePreloader(makeManifest());
    expect(preloader.getState('payments')).toBe('idle');
  });

  it('_reset clears cached state so a route reloads from scratch', async () => {
    const loader = jest.fn().mockResolvedValue({ default: 'V' });
    const manifest = defineRouteManifest({ payments: { path: '/p', name: 'P', loader } });
    const preloader = new RoutePreloader(manifest);

    await preloader.load('payments');
    expect(preloader.getState('payments')).toBe('ready');

    preloader._reset();
    expect(preloader.getState('payments')).toBe('idle');

    await preloader.load('payments');
    expect(loader).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// RouterError::MerchantInactive — inactive merchant mid-resolution tests
// Covers issue #1328: lazy route resolution race condition where a merchant
// becomes inactive after route resolution has already started.
// ---------------------------------------------------------------------------

/** Simulates the RouterError thrown when a merchant is deactivated mid-resolution. */
class RouterError extends Error {
  readonly code: string;
  readonly merchantAddress: string;

  constructor(code: string, merchantAddress: string) {
    super(`RouterError::${code} for merchant ${merchantAddress}`);
    this.name = 'RouterError';
    this.code = code;
    this.merchantAddress = merchantAddress;
  }
}

/**
 * Build a route loader that deactivates a merchant after a specified delay,
 * simulating the race condition where a merchant goes inactive mid-resolution.
 */
function makeMerchantLoader(options: {
  merchantAddress: string;
  deactivateAfterMs?: number;
}): () => Promise<unknown> {
  let active = true;

  // Schedule deactivation after the given delay (default: immediately on next tick).
  const deactivateAfterMs = options.deactivateAfterMs ?? 0;

  return () =>
    new Promise((resolve, reject) => {
      setTimeout(() => {
        if (!active) {
          reject(
            new RouterError('MerchantInactive', options.merchantAddress),
          );
        } else {
          resolve({ default: `MerchantView(${options.merchantAddress})` });
        }
      }, deactivateAfterMs + 1);

      // Trigger deactivation during the loader's async window.
      setTimeout(() => {
        active = false;
      }, deactivateAfterMs);
    });
}

describe('RouterError::MerchantInactive — lazy route resolution', () => {
  it('single-leg: merchant deactivated after resolution starts returns RouterError::MerchantInactive', async () => {
    const MERCHANT_A = 'GBXYZ1234MERCHANT_A';

    const manifest = defineRouteManifest({
      checkout: {
        path: '/checkout',
        name: 'Checkout',
        loader: makeMerchantLoader({ merchantAddress: MERCHANT_A }),
      },
    });

    const preloader = new RoutePreloader(manifest);

    // Resolution has started — deactivation races against the loader.
    await expect(preloader.load('checkout')).rejects.toMatchObject({
      name: 'RouterError',
      code: 'MerchantInactive',
      merchantAddress: MERCHANT_A,
    });

    // State must reflect a hard error, not a silent failure.
    expect(preloader.getState('checkout')).toBe('error');
  });

  it('single-leg: error message includes merchant address for actionable debugging', async () => {
    const MERCHANT_A = 'GBXYZ1234MERCHANT_A';

    const manifest = defineRouteManifest({
      checkout: {
        path: '/checkout',
        name: 'Checkout',
        loader: makeMerchantLoader({ merchantAddress: MERCHANT_A }),
      },
    });

    const preloader = new RoutePreloader(manifest);

    const error = await preloader.load('checkout').catch((e) => e);
    expect(error.message).toContain(MERCHANT_A);
  });

  it('multi-leg: first leg merchant deactivated mid-resolution propagates RouterError::MerchantInactive', async () => {
    const MERCHANT_A = 'GBXYZ1111LEG_A';
    const MERCHANT_B = 'GBXYZ2222LEG_B';

    // Leg A deactivates; Leg B stays healthy.
    const loaderA = makeMerchantLoader({ merchantAddress: MERCHANT_A });
    const loaderB = jest.fn().mockResolvedValue({ default: `MerchantView(${MERCHANT_B})` });

    const manifest = defineRouteManifest({
      legA: { path: '/route/leg-a', name: 'Leg A', loader: loaderA },
      legB: { path: '/route/leg-b', name: 'Leg B', loader: loaderB },
    });

    const preloader = new RoutePreloader(manifest);

    // Leg A must fail with MerchantInactive.
    await expect(preloader.load('legA')).rejects.toMatchObject({
      name: 'RouterError',
      code: 'MerchantInactive',
      merchantAddress: MERCHANT_A,
    });

    // Leg B should still be resolvable independently.
    const resultB = await preloader.load('legB');
    expect(resultB).toEqual({ default: `MerchantView(${MERCHANT_B})` });
  });

  it('multi-leg: second leg merchant deactivated mid-resolution propagates RouterError::MerchantInactive', async () => {
    const MERCHANT_A = 'GBXYZ1111LEG_A';
    const MERCHANT_B = 'GBXYZ2222LEG_B';

    // Leg A stays healthy; Leg B deactivates.
    const loaderA = jest.fn().mockResolvedValue({ default: `MerchantView(${MERCHANT_A})` });
    const loaderB = makeMerchantLoader({ merchantAddress: MERCHANT_B });

    const manifest = defineRouteManifest({
      legA: { path: '/route/leg-a', name: 'Leg A', loader: loaderA },
      legB: { path: '/route/leg-b', name: 'Leg B', loader: loaderB },
    });

    const preloader = new RoutePreloader(manifest);

    // Leg A resolves correctly.
    const resultA = await preloader.load('legA');
    expect(resultA).toEqual({ default: `MerchantView(${MERCHANT_A})` });

    // Leg B fails with MerchantInactive.
    await expect(preloader.load('legB')).rejects.toMatchObject({
      name: 'RouterError',
      code: 'MerchantInactive',
      merchantAddress: MERCHANT_B,
    });
  });

  it('MerchantInactive error is cached — loader is not retried on repeat preload', async () => {
    const MERCHANT_A = 'GBXYZ1234MERCHANT_A';
    let callCount = 0;

    const manifest = defineRouteManifest({
      checkout: {
        path: '/checkout',
        name: 'Checkout',
        loader: () => {
          callCount += 1;
          return Promise.reject(new RouterError('MerchantInactive', MERCHANT_A));
        },
      },
    });

    const preloader = new RoutePreloader(manifest);

    await expect(preloader.load('checkout')).rejects.toMatchObject({ code: 'MerchantInactive' });
    // Second attempt must use the cached rejection — loader must not be called again.
    await expect(preloader.preload('checkout')).rejects.toMatchObject({ code: 'MerchantInactive' });

    expect(callCount).toBe(1);
  });

  it('preloadByIntent does not throw when a merchant becomes inactive during intent-based preload', async () => {
    const MERCHANT_A = 'GBXYZ1234MERCHANT_A';

    const manifest = defineRouteManifest({
      checkout: {
        path: '/checkout',
        name: 'Checkout',
        loader: makeMerchantLoader({ merchantAddress: MERCHANT_A }),
        preloadOn: ['hover'],
      },
    });

    const preloader = new RoutePreloader(manifest);

    // preloadByIntent must not throw even when the merchant is inactive.
    expect(() => preloader.preloadByIntent('hover')).not.toThrow();

    // After the async rejection settles the state should be 'error'.
    await new Promise((r) => setTimeout(r, 20));
    expect(preloader.getState('checkout')).toBe('error');
  });
});
