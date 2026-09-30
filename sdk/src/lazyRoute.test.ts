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
