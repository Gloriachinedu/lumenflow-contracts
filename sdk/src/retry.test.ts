import {
  withRetry,
  isRetryable,
  calculateDelay,
  getRetryAfterMs,
  RetryExhaustedError,
} from './retry';

describe('isRetryable', () => {
  it('retries on network errors (no status property)', () => {
    expect(isRetryable(new Error('network failure'))).toBe(true);
  });

  it('retries on HTTP 429', () => {
    expect(isRetryable({ status: 429 })).toBe(true);
  });

  it('retries on HTTP 503', () => {
    expect(isRetryable({ status: 503 })).toBe(true);
  });

  it('does not retry on HTTP 400', () => {
    expect(isRetryable({ status: 400 })).toBe(false);
  });

  it('does not retry on HTTP 401', () => {
    expect(isRetryable({ status: 401 })).toBe(false);
  });

  it('does not retry on HTTP 404', () => {
    expect(isRetryable({ status: 404 })).toBe(false);
  });
});

describe('calculateDelay', () => {
  it('grows exponentially with attempt number', () => {
    // With jitter=0, delay = base * 2^attempt
    const delay0 = calculateDelay(0, 200, 10_000, 0);
    const delay1 = calculateDelay(1, 200, 10_000, 0);
    const delay2 = calculateDelay(2, 200, 10_000, 0);

    expect(delay0).toBeCloseTo(200);
    expect(delay1).toBeCloseTo(400);
    expect(delay2).toBeCloseTo(800);
  });

  it('caps delay at maxDelayMs', () => {
    const delay = calculateDelay(100, 200, 1_000, 0);
    expect(delay).toBe(1_000);
  });

  it('adds jitter within specified range', () => {
    // Run multiple times; each should be >= base and < base + jitter
    for (let i = 0; i < 20; i++) {
      const d = calculateDelay(0, 200, 10_000, 50);
      expect(d).toBeGreaterThanOrEqual(200);
      expect(d).toBeLessThan(250);
    }
  });
});

describe('getRetryAfterMs', () => {
  it('returns null for non-429 errors', () => {
    expect(getRetryAfterMs({ status: 503 })).toBeNull();
    expect(getRetryAfterMs(new Error('network'))).toBeNull();
    expect(getRetryAfterMs(null)).toBeNull();
  });

  it('returns null for 429 without Retry-After header', () => {
    expect(getRetryAfterMs({ status: 429 })).toBeNull();
  });

  it('parses Retry-After from headers object (lowercase)', () => {
    const err = { status: 429, headers: { 'retry-after': '5' } };
    expect(getRetryAfterMs(err)).toBe(5000);
  });

  it('parses Retry-After from headers object (title-case)', () => {
    const err = { status: 429, headers: { 'Retry-After': '10' } };
    expect(getRetryAfterMs(err)).toBe(10_000);
  });

  it('parses retryAfter numeric property directly', () => {
    const err = { status: 429, retryAfter: 3 };
    expect(getRetryAfterMs(err)).toBe(3000);
  });

  it('returns null when Retry-After header is not a valid number', () => {
    const err = { status: 429, headers: { 'retry-after': 'invalid' } };
    expect(getRetryAfterMs(err)).toBeNull();
  });
});

describe('withRetry', () => {
  // Use tiny delays (1ms base, 0 jitter) so tests run fast
  const fastOptions = { baseDelayMs: 1, jitterMs: 0, maxDelayMs: 5 };

  it('resolves immediately on first success', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds on the 3rd attempt after two network failures', async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error('network error');
      return 'success';
    });

    const result = await withRetry(fn, { ...fastOptions, maxRetries: 3 });

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry on HTTP 400 (no retry on client error)', async () => {
    const clientError = { status: 400, message: 'Bad Request' };
    const fn = jest.fn().mockRejectedValue(clientError);

    await expect(withRetry(fn, fastOptions)).rejects.toEqual(clientError);
    // Should only be called once — no retries
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws RetryExhaustedError after max retries on 503', async () => {
    const serverError = { status: 503, message: 'Service Unavailable' };
    const fn = jest.fn().mockRejectedValue(serverError);

    let thrown: RetryExhaustedError | undefined;
    try {
      await withRetry(fn, { ...fastOptions, maxRetries: 2 });
    } catch (e) {
      thrown = e as RetryExhaustedError;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.retryCount).toBe(2);
    expect(thrown!.lastError).toEqual(serverError);
    expect(thrown!.message).toMatch(/2 retry attempts exhausted/);
    // Called 3 times: initial + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('includes retry count and last error in rejection', async () => {
    const networkError = new Error('timeout');
    const fn = jest.fn().mockRejectedValue(networkError);

    let thrown: RetryExhaustedError | undefined;
    try {
      await withRetry(fn, { ...fastOptions, maxRetries: 1 });
    } catch (e) {
      thrown = e as RetryExhaustedError;
    }

    expect(thrown!.retryCount).toBe(1);
    expect(thrown!.lastError).toBe(networkError);
  });

  // ── 429 Rate Limit Tests ────────────────────────────────────────────────

  it('retries on HTTP 429 and eventually succeeds', async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw { status: 429 };
      return 'rate-limit-recovered';
    });

    const result = await withRetry(fn, { ...fastOptions, maxRetries: 3 });
    expect(result).toBe('rate-limit-recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('honours Retry-After header on 429 and delays accordingly', async () => {
    const delays: number[] = [];
    const origSetTimeout = global.setTimeout;

    // Spy on setTimeout to capture delay values
    jest.spyOn(global, 'setTimeout').mockImplementation((cb: (...args: unknown[]) => void, ms?: number) => {
      delays.push(ms ?? 0);
      return origSetTimeout(cb, 0) as unknown as ReturnType<typeof setTimeout>;
    });

    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) {
        throw { status: 429, headers: { 'retry-after': '2' } }; // 2 seconds
      }
      return 'ok';
    });

    await withRetry(fn, { ...fastOptions, maxRetries: 1 });

    // The delay should be exactly 2000 ms (Retry-After: 2 seconds)
    expect(delays).toContain(2000);

    jest.restoreAllMocks();
  });

  it('uses exponential backoff when 429 has no Retry-After', async () => {
    const delays: number[] = [];
    const origSetTimeout = global.setTimeout;

    jest.spyOn(global, 'setTimeout').mockImplementation((cb: (...args: unknown[]) => void, ms?: number) => {
      delays.push(ms ?? 0);
      return origSetTimeout(cb, 0) as unknown as ReturnType<typeof setTimeout>;
    });

    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) throw { status: 429 }; // No Retry-After
      return 'ok';
    });

    await withRetry(fn, { baseDelayMs: 200, jitterMs: 0, maxDelayMs: 5000, maxRetries: 1 });

    // Without Retry-After, should use exponential backoff (base 200ms, attempt 0 → 200ms)
    expect(delays.length).toBeGreaterThan(0);
    expect(delays[0]).toBeGreaterThanOrEqual(200);

    jest.restoreAllMocks();
  });

  it('respects max retry count for 429 errors', async () => {
    const fn = jest.fn().mockRejectedValue({ status: 429 });

    let thrown: RetryExhaustedError | undefined;
    try {
      await withRetry(fn, { ...fastOptions, maxRetries: 2 });
    } catch (e) {
      thrown = e as RetryExhaustedError;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.retryCount).toBe(2);
    // Called 3 times: initial + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('429 without Retry-After header uses exponential backoff (no crash)', async () => {
    let calls = 0;
    const fn = jest.fn().mockImplementation(async () => {
      calls++;
      if (calls < 2) throw { status: 429, headers: {} };
      return 'ok';
    });

    const result = await withRetry(fn, { ...fastOptions, maxRetries: 2 });
    expect(result).toBe('ok');
  });
});
