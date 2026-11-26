/**
 * Tests for WebhookRetryQueue — retry logic and dead-letter handling.
 * Issue #1541
 */
import { WebhookRetryQueue, WebhookEvent, DeliveryResult } from './webhookRetryQueue';

// ── Helpers ───────────────────────────────────────────────────────────────────

const noop = () => Promise.resolve();

function makeEvent(id = 'evt_1'): WebhookEvent {
  return { id, type: 'payment_processed', payload: { amount: '10.00' } };
}

/**
 * Returns a deliver function that fails `failCount` times with `failStatus`
 * and then succeeds on the next call.
 */
function failThenSucceed(failCount: number, failStatus = 500) {
  let calls = 0;
  return async (_event: WebhookEvent): Promise<DeliveryResult> => {
    calls += 1;
    if (calls <= failCount) return { status: failStatus };
    return { status: 200 };
  };
}

/** Returns a deliver function that always responds with the given status. */
function alwaysRespond(status: number) {
  return async (_event: WebhookEvent): Promise<DeliveryResult> => ({ status });
}

/** Counts how many times the deliver function is called. */
function countingDeliver(inner: (e: WebhookEvent) => Promise<DeliveryResult>) {
  let count = 0;
  async function deliver(event: WebhookEvent): Promise<DeliveryResult> {
    count += 1;
    return inner(event);
  }
  deliver.callCount = () => count;
  return deliver;
}

// ── Successful delivery ───────────────────────────────────────────────────────

describe('WebhookRetryQueue — successful delivery', () => {
  it('delivers immediately on the first attempt', async () => {
    const deliver = countingDeliver(alwaysRespond(200));
    const queue = new WebhookRetryQueue({ deliver, sleep: noop });

    const result = await queue.enqueue(makeEvent());
    expect(result).toBe('delivered');
    expect(deliver.callCount()).toBe(1);
  });

  it('delivers on the second attempt after one 500 failure', async () => {
    const deliver = countingDeliver(failThenSucceed(1, 500));
    const queue = new WebhookRetryQueue({ deliver, sleep: noop });

    const result = await queue.enqueue(makeEvent());
    expect(result).toBe('delivered');
    expect(deliver.callCount()).toBe(2);
  });

  it('delivers on retry 2 and does NOT dead-letter the event', async () => {
    const deliver = countingDeliver(failThenSucceed(2, 503));
    const queue = new WebhookRetryQueue({ deliver, sleep: noop });

    const result = await queue.enqueue(makeEvent());
    expect(result).toBe('delivered');
    expect(queue.listDeadLetterEvents()).toHaveLength(0);
    expect(deliver.callCount()).toBe(3); // 2 failures + 1 success
  });
});

// ── Dead-letter after 5 failures ─────────────────────────────────────────────

describe('WebhookRetryQueue — dead-letter queue', () => {
  it('dead-letters an event after 5 consecutive 500 failures', async () => {
    const deliver = countingDeliver(alwaysRespond(500));
    const queue = new WebhookRetryQueue({ deliver, sleep: noop, maxAttempts: 5 });

    const result = await queue.enqueue(makeEvent());
    expect(result).toBe('dead-lettered');
    expect(deliver.callCount()).toBe(5);

    const dlq = queue.listDeadLetterEvents();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].event.id).toBe('evt_1');
    expect(dlq[0].attempts).toBe(5);
    expect(dlq[0].lastStatus).toBe(500);
  });

  it('dead-letters after 5 throws (no HTTP response)', async () => {
    const deliver = async (_: WebhookEvent): Promise<DeliveryResult> => {
      throw new Error('connection refused');
    };
    const queue = new WebhookRetryQueue({ deliver, sleep: noop, maxAttempts: 5 });

    const result = await queue.enqueue(makeEvent());
    expect(result).toBe('dead-lettered');

    const dlq = queue.listDeadLetterEvents();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].errors.some((e) => e.includes('connection refused'))).toBe(true);
  });

  it('records all error messages in the DLQ entry', async () => {
    const deliver = countingDeliver(alwaysRespond(502));
    const queue = new WebhookRetryQueue({ deliver, sleep: noop, maxAttempts: 3 });

    await queue.enqueue(makeEvent());

    const entry = queue.getDeadLetterEvent('evt_1');
    expect(entry).toBeDefined();
    expect(entry!.errors).toHaveLength(3);
  });

  it('listDeadLetterEvents returns entries ordered oldest-first', async () => {
    // Use separate queues to stagger timestamps, or just enqueue two events
    // and trust the sort by checking stable relative order.
    const deliver = countingDeliver(alwaysRespond(500));
    const queue = new WebhookRetryQueue({ deliver, sleep: noop, maxAttempts: 1 });

    await queue.enqueue(makeEvent('a'));
    await queue.enqueue(makeEvent('b'));

    const entries = queue.listDeadLetterEvents();
    expect(entries).toHaveLength(2);
    expect(entries[0].event.id).toBe('a');
    expect(entries[1].event.id).toBe('b');
  });
});

// ── Non-retryable failures ───────────────────────────────────────────────────

describe('WebhookRetryQueue — non-retryable status codes', () => {
  it('dead-letters immediately on a 400 without retrying', async () => {
    const deliver = countingDeliver(alwaysRespond(400));
    const queue = new WebhookRetryQueue({ deliver, sleep: noop, maxAttempts: 5 });

    const result = await queue.enqueue(makeEvent());
    expect(result).toBe('dead-lettered');
    // Must not retry a non-retryable status
    expect(deliver.callCount()).toBe(1);
  });

  it('dead-letters immediately on a 401', async () => {
    const deliver = countingDeliver(alwaysRespond(401));
    const queue = new WebhookRetryQueue({ deliver, sleep: noop, maxAttempts: 5 });

    await queue.enqueue(makeEvent());
    expect(deliver.callCount()).toBe(1);
  });
});

// ── Backoff timing ────────────────────────────────────────────────────────────

describe('WebhookRetryQueue — exponential backoff', () => {
  it('calls sleep with doubling delays: 1 s, 2 s, 4 s, 8 s', async () => {
    const sleepDelays: number[] = [];
    const sleep = (ms: number) => {
      sleepDelays.push(ms);
      return Promise.resolve();
    };

    const deliver = countingDeliver(alwaysRespond(500));
    const queue = new WebhookRetryQueue({
      deliver,
      sleep,
      maxAttempts: 5,
      baseDelayMs: 1_000,
    });

    await queue.enqueue(makeEvent());

    // 5 attempts → 4 sleeps between attempts
    expect(sleepDelays).toEqual([1_000, 2_000, 4_000, 8_000]);
  });

  it('caps the delay at maxDelayMs', async () => {
    const sleepDelays: number[] = [];
    const sleep = (ms: number) => { sleepDelays.push(ms); return Promise.resolve(); };

    const deliver = countingDeliver(alwaysRespond(500));
    const queue = new WebhookRetryQueue({
      deliver,
      sleep,
      maxAttempts: 5,
      baseDelayMs: 1_000,
      maxDelayMs: 3_000,
    });

    await queue.enqueue(makeEvent());
    expect(Math.max(...sleepDelays)).toBe(3_000);
  });
});

// ── Replay (admin API) ────────────────────────────────────────────────────────

describe('WebhookRetryQueue — replay dead-letter events', () => {
  it('removes an event from the DLQ after a successful replay', async () => {
    // First: dead-letter the event
    const failAll = countingDeliver(alwaysRespond(500));
    const queue = new WebhookRetryQueue({ deliver: failAll, sleep: noop, maxAttempts: 5 });
    await queue.enqueue(makeEvent());
    expect(queue.listDeadLetterEvents()).toHaveLength(1);

    // Swap the deliver function to succeed, then replay
    // We replace deliver by rebuilding the queue with the same DLQ state
    // by calling replayDeadLetterEvent with a patched deliver.
    // Since queue.deliver is private, we test through the public API:
    // create a new queue that wraps the DLQ entry.
    const successDeliver = alwaysRespond(200);
    // Inject succeed deliver by patching via a subclass
    const entry = queue.getDeadLetterEvent('evt_1')!;
    expect(entry).toBeDefined();

    // Directly patch the private deliver field for testing (TypeScript cast)
    (queue as any).deliver = successDeliver;
    const replayResult = await queue.replayDeadLetterEvent('evt_1');

    expect(replayResult).toBe('delivered');
    expect(queue.listDeadLetterEvents()).toHaveLength(0);
  });

  it('keeps the event in the DLQ if replay fails', async () => {
    const failAll = countingDeliver(alwaysRespond(500));
    const queue = new WebhookRetryQueue({ deliver: failAll, sleep: noop, maxAttempts: 1 });
    await queue.enqueue(makeEvent());

    const replayResult = await queue.replayDeadLetterEvent('evt_1');
    expect(replayResult).toBe('failed');
    expect(queue.listDeadLetterEvents()).toHaveLength(1);
  });

  it('throws when replaying an event not in the DLQ', async () => {
    const queue = new WebhookRetryQueue({ deliver: alwaysRespond(200), sleep: noop });
    await expect(queue.replayDeadLetterEvent('nonexistent')).rejects.toThrow(
      'Dead-letter event not found'
    );
  });
});

// ── Admin: view dead-letter events ───────────────────────────────────────────

describe('WebhookRetryQueue — admin view', () => {
  it('getDeadLetterEvent returns undefined for unknown id', async () => {
    const queue = new WebhookRetryQueue({ deliver: alwaysRespond(200), sleep: noop });
    expect(queue.getDeadLetterEvent('unknown')).toBeUndefined();
  });

  it('clearDeadLetterQueue empties the DLQ', async () => {
    const queue = new WebhookRetryQueue({
      deliver: alwaysRespond(500),
      sleep: noop,
      maxAttempts: 1,
    });
    await queue.enqueue(makeEvent('a'));
    await queue.enqueue(makeEvent('b'));
    expect(queue.listDeadLetterEvents()).toHaveLength(2);

    queue.clearDeadLetterQueue();
    expect(queue.listDeadLetterEvents()).toHaveLength(0);
  });
});
