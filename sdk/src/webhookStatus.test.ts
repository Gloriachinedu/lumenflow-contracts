import { WebhookStatusTracker } from './webhookStatus';
import { WebhookRelay, WebhookDeliveryError } from './webhookRelay';

function makeRelay(deliver: jest.Mock) {
  return new WebhookRelay({ deliver, maxAttempts: 2, baseDelayMs: 0, sleep: async () => {} });
}

const event = { pagingToken: 'tok-1', id: 'evt-1', type: 'payment_processed' };

describe('WebhookStatusTracker', () => {
  it('reports delivered state on success', async () => {
    const deliver = jest.fn().mockResolvedValue({ status: 200 });
    const tracker = new WebhookStatusTracker(makeRelay(deliver));

    await tracker.relay(event);

    const status = tracker.getStatus('tok-1');
    expect(status?.state).toBe('delivered');
    expect(status?.willRetry).toBe(false);
    expect(status?.deliveredAt).toBeDefined();
  });

  it('reports failed state after exhausted retries', async () => {
    const deliver = jest.fn().mockResolvedValue({ status: 503 });
    const tracker = new WebhookStatusTracker(makeRelay(deliver));

    await expect(tracker.relay(event)).rejects.toBeInstanceOf(WebhookDeliveryError);

    const status = tracker.getStatus('tok-1');
    expect(status?.state).toBe('failed');
    expect(status?.willRetry).toBe(false);
    expect(status?.lastHttpStatus).toBe(503);
  });

  it('throws when event has no idempotency key', async () => {
    const deliver = jest.fn().mockResolvedValue({ status: 200 });
    const tracker = new WebhookStatusTracker(makeRelay(deliver));
    await expect(tracker.relay({})).rejects.toThrow(TypeError);
  });

  it('summary returns correct counts', async () => {
    const deliver = jest.fn().mockResolvedValue({ status: 200 });
    const tracker = new WebhookStatusTracker(makeRelay(deliver));

    await tracker.relay({ pagingToken: 'a', type: 'evt' });
    await tracker.relay({ pagingToken: 'b', type: 'evt' });

    const s = tracker.summary();
    expect(s.delivered).toBe(2);
    expect(s.total).toBe(2);
    expect(s.failed).toBe(0);
  });

  it('listStatuses filters by state', async () => {
    const deliver = jest.fn()
      .mockResolvedValueOnce({ status: 200 })
      .mockResolvedValue({ status: 503 });

    const tracker = new WebhookStatusTracker(makeRelay(deliver));
    await tracker.relay({ pagingToken: 'ok-1', type: 'evt' });
    await expect(tracker.relay({ pagingToken: 'fail-1', type: 'evt' })).rejects.toThrow();

    const failed = tracker.listStatuses({ state: 'failed' });
    expect(failed).toHaveLength(1);
    expect(failed[0].key).toBe('fail-1');
  });
});

describe('getWebhookDeliveryStatus', () => {
  it('returns delivered status for a successfully relayed event', async () => {
    const deliver = jest.fn().mockResolvedValue({ status: 200 });
    const tracker = new WebhookStatusTracker(makeRelay(deliver));

    await tracker.relay(event);

    const status = tracker.getWebhookDeliveryStatus('evt-1');
    expect(status).not.toBeNull();
    expect(status?.delivered).toBe(true);
    expect(status?.attempts).toBe(1);
    expect(typeof status?.lastAttemptAt).toBe('string');
    expect(status?.lastAttemptAt).toBeDefined();
  });

  it('returns failed status with attempts after exhausted retries', async () => {
    const deliver = jest.fn().mockResolvedValue({ status: 503 });
    const tracker = new WebhookStatusTracker(makeRelay(deliver));

    await expect(tracker.relay(event)).rejects.toBeInstanceOf(WebhookDeliveryError);

    const status = tracker.getWebhookDeliveryStatus('evt-1');
    expect(status).not.toBeNull();
    expect(status?.delivered).toBe(false);
    expect(status?.attempts).toBe(2);
    expect(typeof status?.lastAttemptAt).toBe('string');
  });

  it('returns pending status for a record not yet delivered', async () => {
    const deliver = jest.fn().mockResolvedValue({ status: 200 });
    const tracker = new WebhookStatusTracker(makeRelay(deliver));

    const pending = tracker.getWebhookDeliveryStatus('evt-pending');
    expect(pending).toBeNull();

    tracker.markPending('evt-pending');
    const status = tracker.getWebhookDeliveryStatus('evt-pending');
    expect(status).not.toBeNull();
    expect(status?.delivered).toBe(false);
    expect(status?.attempts).toBe(0);
  });

  it('returns null for unknown event IDs', () => {
    const deliver = jest.fn().mockResolvedValue({ status: 200 });
    const tracker = new WebhookStatusTracker(makeRelay(deliver));

    expect(tracker.getWebhookDeliveryStatus('does-not-exist')).toBeNull();
  });
});
