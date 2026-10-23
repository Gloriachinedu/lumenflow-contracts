import { subscribe, LumenFlowEvent } from './events';

// Minimal EventSource mock
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emit(data: object) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  triggerError() {
    this.onerror?.(new Event('error'));
  }

  open() {
    this.onopen?.();
  }

  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  MockEventSource.instances = [];
  (global as any).EventSource = MockEventSource;
});

test('calls callback for matching event', () => {
  const received: LumenFlowEvent[] = [];
  const unsub = subscribe('CONTRACT_ID', { eventName: 'refund_approved' }, (e) => received.push(e));

  const es = MockEventSource.instances[0];
  es.emit({ id: '1', type: 'contract', topic: ['lumenflow', 'refund_approved'], value: '{}' });
  es.emit({ id: '2', type: 'contract', topic: ['lumenflow', 'payment_processed'], value: '{}' });

  expect(received).toHaveLength(1);
  expect(received[0].id).toBe('1');
  unsub();
});

test('no filter passes all events', () => {
  const received: LumenFlowEvent[] = [];
  const unsub = subscribe('CONTRACT_ID', {}, (e) => received.push(e));

  const es = MockEventSource.instances[0];
  es.emit({ id: '1', type: 'contract', topic: ['lumenflow', 'payment_processed'], value: '{}' });
  es.emit({ id: '2', type: 'contract', topic: ['lumenflow', 'refund_approved'], value: '{}' });

  expect(received).toHaveLength(2);
  unsub();
});

test('unsubscribe stops receiving events', () => {
  const received: LumenFlowEvent[] = [];
  const unsub = subscribe('CONTRACT_ID', {}, (e) => received.push(e));
  unsub();

  const es = MockEventSource.instances[0];
  expect(es.closed).toBe(true);
  es.emit({ id: '1', type: 'contract', topic: ['lumenflow', 'payment_processed'], value: '{}' });
  expect(received).toHaveLength(0);
});

test('reconnects on error', () => {
  jest.useFakeTimers();
  const unsub = subscribe('CONTRACT_ID', {}, () => {});

  const es1 = MockEventSource.instances[0];
  es1.triggerError();

  jest.advanceTimersByTime(1_100);
  expect(MockEventSource.instances).toHaveLength(2);

  unsub();
  jest.useRealTimers();
});

test('emits reconnecting and reconnected lifecycle callbacks', () => {
  jest.useFakeTimers();
  const onReconnecting = jest.fn();
  const onReconnected = jest.fn();
  const unsub = subscribe('CONTRACT_ID', {}, () => {}, { onReconnecting, onReconnected });

  MockEventSource.instances[0].triggerError();
  expect(onReconnecting).toHaveBeenCalledWith(1, 1_000);
  jest.advanceTimersByTime(1_000);
  MockEventSource.instances[1].open();
  expect(onReconnected).toHaveBeenCalledTimes(1);

  unsub();
  jest.useRealTimers();
});

test('emits an error and stops after five failed reconnect attempts', () => {
  jest.useFakeTimers();
  const onError = jest.fn();
  const unsub = subscribe('CONTRACT_ID', {}, () => {}, { onError });
  const retryDelays = [1_000, 2_000, 4_000, 8_000, 16_000];

  for (const delayMs of retryDelays) {
    MockEventSource.instances[MockEventSource.instances.length - 1].triggerError();
    jest.advanceTimersByTime(delayMs);
  }
  MockEventSource.instances[MockEventSource.instances.length - 1].triggerError();

  expect(MockEventSource.instances).toHaveLength(6);
  expect(onError).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(60_000);
  expect(MockEventSource.instances).toHaveLength(6);

  unsub();
  jest.useRealTimers();
});
