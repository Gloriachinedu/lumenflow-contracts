/**
 * Integration tests for webhook retry and deduplication (issue #877).
 *
 * These exercise the {@link WebhookRelay} against a stubbed downstream webhook
 * that can be scripted to return success, transient errors, permanent errors or
 * to throw network failures. Backoff sleeps are stubbed so the suite runs
 * without real timers.
 *
 * Covered:
 *   - normal path: an event is delivered exactly once
 *   - deduplication: Horizon replays / RPC re-polls do not double-deliver
 *   - deduplication across relay instances sharing a store
 *   - retry: transient 5xx / 429 / network failure recovers and delivers
 *   - retry budget exhaustion: WebhookDeliveryError, key NOT recorded, redelivery works
 *   - fail-fast: non-retryable 4xx (401/422) does not retry and does not record the key
 *   - boundary: event with no idempotency key is rejected
 *   - ordering: relayBatch stops at the first hard failure so the cursor can be saved
 */

import {
  WebhookRelay,
  WebhookDeliveryError,
  MemoryDedupeStore,
  RelayEvent,
  idempotencyKey,
} from '../webhookRelay';

const noSleep = () => Promise.resolve();

function event(overrides: Partial<RelayEvent> = {}): RelayEvent {
  return {
    pagingToken: 'token-1',
    id: 'evt-1',
    type: 'payment_processed',
    topic: ['lumenflow', 'payment_processed', 'GMERCHANT'],
    value: { order_id: 'ORDER-1', amount: 1000 },
    ledger: 42,
    ...overrides,
  };
}

/** A scripted downstream webhook. Each call consumes the next script entry;
 *  once the script is exhausted the `tail` behaviour repeats. */
function scriptedWebhook(
  script: Array<number | 'throw'>,
  tail: number | 'throw' = 200,
) {
  const calls: RelayEvent[] = [];
  let i = 0;
  const fn = jest.fn(async (e: RelayEvent) => {
    calls.push(e);
    const step = i < script.length ? script[i++] : tail;
    if (step === 'throw') throw new Error('ECONNRESET: socket hang up');
    return { status: step };
  });
  return { fn, calls };
}

describe('WebhookRelay — normal path', () => {
  it('delivers an event exactly once and records its key', async () => {
    const { fn } = scriptedWebhook([], 200);
    const store = new MemoryDedupeStore();
    const relay = new WebhookRelay({ deliver: fn, store, sleep: noSleep });

    const outcome = await relay.relay(event());

    expect(outcome).toEqual({ status: 'delivered', key: 'token-1', attempts: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.has('token-1')).toBe(true);
  });

  it('falls back to the event id when no paging token is present', async () => {
    const { fn } = scriptedWebhook([], 200);
    const relay = new WebhookRelay({ deliver: fn, sleep: noSleep });

    const outcome = await relay.relay(event({ pagingToken: undefined, id: 'evt-99' }));

    expect(outcome.key).toBe('evt-99');
    expect(idempotencyKey(event({ pagingToken: undefined, id: 'evt-99' }))).toBe('evt-99');
  });
});

describe('WebhookRelay — deduplication', () => {
  it('drops a replayed event without calling the webhook again', async () => {
    const { fn } = scriptedWebhook([], 200);
    const relay = new WebhookRelay({ deliver: fn, sleep: noSleep });

    const first = await relay.relay(event());
    const replay = await relay.relay(event()); // same paging token
    const replay2 = await relay.relay(event());

    expect(first.status).toBe('delivered');
    expect(replay).toEqual({ status: 'duplicate', key: 'token-1', attempts: 0 });
    expect(replay2.status).toBe('duplicate');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('deduplicates across relay instances that share a store', async () => {
    const store = new MemoryDedupeStore();
    const a = scriptedWebhook([], 200);
    const b = scriptedWebhook([], 200);

    await new WebhookRelay({ deliver: a.fn, store, sleep: noSleep }).relay(event());
    // Simulate a process restart: a fresh relay, same persistent store.
    const out = await new WebhookRelay({ deliver: b.fn, store, sleep: noSleep }).relay(event());

    expect(out.status).toBe('duplicate');
    expect(b.fn).not.toHaveBeenCalled();
    expect(store.size).toBe(1);
  });

  it('treats distinct paging tokens as distinct events', async () => {
    const { fn } = scriptedWebhook([], 200);
    const relay = new WebhookRelay({ deliver: fn, sleep: noSleep });

    await relay.relay(event({ pagingToken: 'token-1' }));
    await relay.relay(event({ pagingToken: 'token-2' }));

    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('WebhookRelay — retry on transient failures', () => {
  it('retries a 503 then succeeds', async () => {
    const { fn } = scriptedWebhook([503, 503], 200);
    const relay = new WebhookRelay({ deliver: fn, sleep: noSleep });

    const outcome = await relay.relay(event());

    expect(outcome).toEqual({ status: 'delivered', key: 'token-1', attempts: 3 });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('retries HTTP 429 (rate limited)', async () => {
    const { fn } = scriptedWebhook([429], 200);
    const relay = new WebhookRelay({ deliver: fn, sleep: noSleep });

    const outcome = await relay.relay(event());
    expect(outcome.attempts).toBe(2);
  });

  it('retries a thrown network error', async () => {
    const { fn } = scriptedWebhook(['throw', 'throw'], 200);
    const relay = new WebhookRelay({ deliver: fn, sleep: noSleep });

    const outcome = await relay.relay(event());
    expect(outcome.status).toBe('delivered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('applies exponential backoff between attempts', async () => {
    const delays: number[] = [];
    const { fn } = scriptedWebhook([503, 503], 200);
    const relay = new WebhookRelay({
      deliver: fn,
      baseDelayMs: 100,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await relay.relay(event());
    expect(delays).toEqual([100, 200]);
  });

  it('caps the backoff at maxDelayMs', async () => {
    const delays: number[] = [];
    const { fn } = scriptedWebhook([503, 503, 503, 503, 503], 200);
    const relay = new WebhookRelay({
      deliver: fn,
      maxAttempts: 6,
      baseDelayMs: 1000,
      maxDelayMs: 3000,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    await relay.relay(event());
    expect(delays).toEqual([1000, 2000, 3000, 3000, 3000]);
  });
});

describe('WebhookRelay — retry budget exhaustion', () => {
  it('throws WebhookDeliveryError and does NOT record the key', async () => {
    const { fn } = scriptedWebhook([], 503); // always 503
    const store = new MemoryDedupeStore();
    const relay = new WebhookRelay({ deliver: fn, store, maxAttempts: 3, sleep: noSleep });

    await expect(relay.relay(event())).rejects.toBeInstanceOf(WebhookDeliveryError);
    expect(fn).toHaveBeenCalledTimes(3);
    expect(store.has('token-1')).toBe(false);
  });

  it('redelivers the event on a later poll once the webhook recovers', async () => {
    const store = new MemoryDedupeStore();
    const down = scriptedWebhook([], 503);
    const up = scriptedWebhook([], 200);

    await expect(
      new WebhookRelay({ deliver: down.fn, store, maxAttempts: 2, sleep: noSleep }).relay(event()),
    ).rejects.toBeInstanceOf(WebhookDeliveryError);

    // Next poll cycle: webhook is healthy again.
    const outcome = await new WebhookRelay({ deliver: up.fn, store, sleep: noSleep }).relay(event());

    expect(outcome.status).toBe('delivered');
    expect(up.fn).toHaveBeenCalledTimes(1);
    expect(store.has('token-1')).toBe(true);
  });

  it('exposes attempt count and last status on the error', async () => {
    const { fn } = scriptedWebhook([], 502);
    const relay = new WebhookRelay({ deliver: fn, maxAttempts: 3, sleep: noSleep });

    try {
      await relay.relay(event());
      throw new Error('expected WebhookDeliveryError');
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookDeliveryError);
      const e = err as WebhookDeliveryError;
      expect(e.attempts).toBe(3);
      expect(e.lastStatus).toBe(502);
      expect(e.event.pagingToken).toBe('token-1');
    }
  });
});

describe('WebhookRelay — fail fast on non-retryable responses', () => {
  it('does not retry a 401 and does not record the key', async () => {
    const { fn } = scriptedWebhook([], 401);
    const store = new MemoryDedupeStore();
    const relay = new WebhookRelay({ deliver: fn, store, sleep: noSleep });

    await expect(relay.relay(event())).rejects.toMatchObject({
      name: 'WebhookDeliveryError',
      lastStatus: 401,
      attempts: 1,
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(store.has('token-1')).toBe(false);
  });

  it('does not retry a 422 (permanent validation failure)', async () => {
    const { fn } = scriptedWebhook([], 422);
    const relay = new WebhookRelay({ deliver: fn, sleep: noSleep });

    await expect(relay.relay(event())).rejects.toBeInstanceOf(WebhookDeliveryError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('WebhookRelay — boundary conditions', () => {
  it('rejects an event with no paging token and no id', async () => {
    const { fn } = scriptedWebhook([], 200);
    const relay = new WebhookRelay({ deliver: fn, sleep: noSleep });

    await expect(relay.relay(event({ pagingToken: undefined, id: undefined }))).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(fn).not.toHaveBeenCalled();
    expect(idempotencyKey({})).toBeNull();
  });
});

describe('WebhookRelay — sustained throughput (issue #1578)', () => {
  // 1000 events/min for 5 minutes == 5000 events. We compress the wall clock
  // (the relay's sleeps are stubbed) but keep the event count and the
  // per-event latency budget identical to the load-test scenario so this
  // suite catches relay-level regressions before the full load test runs.
  const EVENTS_PER_MINUTE = 1000;
  const DURATION_MINUTES = 5;
  const TOTAL_EVENTS = EVENTS_PER_MINUTE * DURATION_MINUTES;
  const P99_BUDGET_MS = 2000;

  function percentile(samples: number[], p: number): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
  }

  it('delivers every event with P99 latency under budget and zero drops', async () => {
    const store = new MemoryDedupeStore();
    const latencies: number[] = [];
    let delivered = 0;

    const deliver = jest.fn(async () => {
      // Simulate a downstream webhook with a small, bounded service time.
      await Promise.resolve();
      return { status: 200 };
    });
    const relay = new WebhookRelay({ deliver, store, sleep: noSleep });

    const startedAt = Date.now();
    for (let i = 0; i < TOTAL_EVENTS; i++) {
      const t0 = Date.now();
      const outcome = await relay.relay(
        event({ pagingToken: `load-${i}`, id: `load-${i}` }),
      );
      latencies.push(Date.now() - t0);
      if (outcome.status === 'delivered') delivered++;
    }
    const elapsedMs = Date.now() - startedAt;

    // Zero events dropped at target throughput.
    expect(delivered).toBe(TOTAL_EVENTS);
    expect(deliver).toHaveBeenCalledTimes(TOTAL_EVENTS);
    expect(store.size).toBe(TOTAL_EVENTS);

    // P99 delivery latency stays within the 2s performance budget.
    const p99 = percentile(latencies, 99);
    expect(p99).toBeLessThan(P99_BUDGET_MS);

    // Sanity: the compressed run should comfortably beat the real-time budget.
    expect(elapsedMs).toBeLessThan(P99_BUDGET_MS);
  });

  it('keeps P99 within budget when the downstream intermittently fails', async () => {
    const store = new MemoryDedupeStore();
    const latencies: number[] = [];
    let delivered = 0;
    let call = 0;

    const deliver = jest.fn(async () => {
      call++;
      // Every 100th call is a transient failure that the relay retries.
      return { status: call % 100 === 0 ? 503 : 200 };
    });
    const relay = new WebhookRelay({ deliver, store, sleep: noSleep });

    for (let i = 0; i < TOTAL_EVENTS; i++) {
      const t0 = Date.now();
      const outcome = await relay.relay(
        event({ pagingToken: `flaky-${i}`, id: `flaky-${i}` }),
      );
      latencies.push(Date.now() - t0);
      if (outcome.status === 'delivered') delivered++;
    }

    expect(delivered).toBe(TOTAL_EVENTS);
    expect(store.size).toBe(TOTAL_EVENTS);
    expect(percentile(latencies, 99)).toBeLessThan(P99_BUDGET_MS);
  });

  it('does not double-deliver under concurrent duplicate bursts', async () => {
    const store = new MemoryDedupeStore();
    const deliver = jest.fn(async () => ({ status: 200 }));
    const relay = new WebhookRelay({ deliver, store, sleep: noSleep });

    // A burst of replays for the same 100 events, interleaved.
    const burst: Promise<unknown>[] = [];
    for (let round = 0; round < 10; round++) {
      for (let i = 0; i < 100; i++) {
        burst.push(relay.relay(event({ pagingToken: `burst-${i}`, id: `burst-${i}` })));
      }
    }
    const outcomes = (await Promise.all(burst)) as Array<{ status: string }>;

    const deliveredCount = outcomes.filter((o) => o.status === 'delivered').length;
    const duplicateCount = outcomes.filter((o) => o.status === 'duplicate').length;

    expect(deliveredCount).toBe(100);
    expect(duplicateCount).toBe(900);
    expect(deliver).toHaveBeenCalledTimes(100);
    expect(store.size).toBe(100);
  });
});

describe('WebhookRelay — ordered batch delivery', () => {
  it('delivers a batch in order and returns per-event outcomes', async () => {
    const { fn, calls } = scriptedWebhook([], 200);
    const relay = new WebhookRelay({ deliver: fn, sleep: noSleep });

    const outcomes = await relay.relayBatch([
      event({ pagingToken: 't1' }),
      event({ pagingToken: 't2' }),
      event({ pagingToken: 't1' }), // replay mid-batch
      event({ pagingToken: 't3' }),
    ]);

    expect(outcomes.map((o) => o.status)).toEqual(['delivered', 'delivered', 'duplicate', 'delivered']);
    expect(calls.map((c) => c.pagingToken)).toEqual(['t1', 't2', 't3']);
  });

  it('stops at the first hard failure so the caller can persist the cursor', async () => {
    const fn = jest.fn(async (e: RelayEvent) => {
      if (e.pagingToken === 't2') return { status: 401 };
      return { status: 200 };
    });
    const relay = new WebhookRelay({ deliver: fn, sleep: noSleep });

    const batch = [event({ pagingToken: 't1' }), event({ pagingToken: 't2' }), event({ pagingToken: 't3' })];

    await expect(relay.relayBatch(batch)).rejects.toBeInstanceOf(WebhookDeliveryError);
    // t1 delivered, t2 failed hard, t3 never attempted.
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
