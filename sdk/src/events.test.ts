import { subscribe, LumenFlowEvent } from './events';

// Minimal EventSource mock
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
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
    this.onerror?.();
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
