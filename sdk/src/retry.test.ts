import {
  withRetry,
  isRetryable,
  calculateDelay,
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
});
