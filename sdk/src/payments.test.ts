import {
  subscribeToPayments,
  parsePaymentEvent,
  IEventSource,
  PaymentCallback,
  SubscribeOptions,
} from './payments';
import { PaymentEvent } from './types';

// ── Mock EventSource ──────────────────────────────────────────────────────────

/** Minimal mock that lets tests trigger onmessage / onerror manually. */
class MockEventSource implements IEventSource {
  public onmessage: ((event: MessageEvent) => void) | null = null;
  public onerror: ((event: Event) => void) | null = null;
  public closed = false;
  public url: string;

  constructor(url: string) {
    this.url = url;
  }

  close(): void {
    this.closed = true;
  }

  /** Simulate an incoming SSE message. */
  emit(data: Record<string, unknown>): void {
    if (this.onmessage) {
      const event = { data: JSON.stringify(data) } as MessageEvent;
      this.onmessage(event);
    }
  }

  /** Simulate an SSE error. */
  emitError(): void {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }
}

// ── parsePaymentEvent tests ──────────────────────────────────────────────────

describe('parsePaymentEvent', () => {
  it('maps Horizon payment fields to PaymentEvent', () => {
    const raw = {
      type: 'payment',
      id: 'OP1234',
      to: 'GMERCHANT',
      from: 'GPAYER',
      asset_code: 'USDC',
      amount: '10.5000000',
      created_at: '2024-01-15T12:00:00Z',
    };

    const event = parsePaymentEvent(raw);

    expect(event.type).toBe('payment');
    expect(event.order_id).toBe('OP1234');
    expect(event.merchant_address).toBe('GMERCHANT');
    expect(event.payer).toBe('GPAYER');
    expect(event.token).toBe('USDC');
    // 10.5 XLM = 105_000_000 stroops
    expect(event.amount).toBe(105_000_000n);
    expect(event.raw).toBe(raw);
  });

  it('falls back to asset_type when asset_code is missing', () => {
    const raw = { asset_type: 'native', amount: '1.0000000' };
    const event = parsePaymentEvent(raw);
    expect(event.token).toBe('native');
  });

  it('uses "payment" as default type when type is missing', () => {
    const event = parsePaymentEvent({});
    expect(event.type).toBe('payment');
  });

  it('returns 0n for amount when amount field is missing', () => {
    const event = parsePaymentEvent({});
    expect(event.amount).toBe(0n);
  });

  it('returns 0n for timestamp when created_at is missing', () => {
    const event = parsePaymentEvent({});
    expect(event.timestamp).toBe(0n);
  });
});

// ── subscribeToPayments tests ────────────────────────────────────────────────

function makeFactory(mockEs: MockEventSource): SubscribeOptions['eventSourceFactory'] {
  return (_url: string) => mockEs;
}

describe('subscribeToPayments', () => {
  jest.useFakeTimers();

  afterEach(() => {
    jest.clearAllTimers();
  });

  it('invokes callback when a payment event arrives for the merchant', () => {
    const mockEs = new MockEventSource('');
    const callback: PaymentCallback = jest.fn();

    subscribeToPayments('GMERCHANT', callback, {
      eventSourceFactory: makeFactory(mockEs),
    });

    mockEs.emit({
      type: 'payment',
      id: 'OP1',
      to: 'GMERCHANT',
      from: 'GPAYER',
      asset_type: 'native',
      amount: '5.0000000',
    });

    expect(callback).toHaveBeenCalledTimes(1);
    const event = (callback as jest.Mock).mock.calls[0][0] as PaymentEvent;
    expect(event.merchant_address).toBe('GMERCHANT');
    expect(event.payer).toBe('GPAYER');
    expect(event.amount).toBe(50_000_000n);
  });

  it('does not invoke callback for events directed at a different address', () => {
    const mockEs = new MockEventSource('');
    const callback: PaymentCallback = jest.fn();

    subscribeToPayments('GMERCHANT', callback, {
      eventSourceFactory: makeFactory(mockEs),
    });

    mockEs.emit({
      type: 'payment',
      id: 'OP2',
      to: 'GDIFFERENTMERCHANT',
      from: 'GPAYER',
      amount: '1.0000000',
    });

    expect(callback).not.toHaveBeenCalled();
  });

  it('unsubscribe() closes the EventSource and stops callbacks', () => {
    const mockEs = new MockEventSource('');
    const callback: PaymentCallback = jest.fn();

    const sub = subscribeToPayments('GMERCHANT', callback, {
      eventSourceFactory: makeFactory(mockEs),
    });

    sub.unsubscribe();

    expect(mockEs.closed).toBe(true);

    // Events emitted after unsubscribe should not invoke the callback
    mockEs.emit({ to: 'GMERCHANT', type: 'payment', amount: '1.0' });
    expect(callback).not.toHaveBeenCalled();
  });

  it('reconnects after inactivity timeout', () => {
    const instances: MockEventSource[] = [];
    const factory = (_url: string): IEventSource => {
      const es = new MockEventSource(_url);
      instances.push(es);
      return es;
    };

    subscribeToPayments('GMERCHANT', jest.fn(), {
      eventSourceFactory: factory,
      inactivityTimeoutMs: 1000,
    });

    expect(instances).toHaveLength(1);

    // Advance time past the inactivity timeout
    jest.advanceTimersByTime(1001);

    // A new EventSource should have been created
    expect(instances.length).toBeGreaterThanOrEqual(2);
  });

  it('resets inactivity timer on each received message', () => {
    const instances: MockEventSource[] = [];
    const factory = (_url: string): IEventSource => {
      const es = new MockEventSource(_url);
      instances.push(es);
      return es;
    };

    subscribeToPayments('GMERCHANT', jest.fn(), {
      eventSourceFactory: factory,
      inactivityTimeoutMs: 1000,
    });

    // Advance by 800ms — no reconnect yet
    jest.advanceTimersByTime(800);

    // Emit a message to reset the timer
    instances[0].emit({ to: 'GMERCHANT', type: 'payment', amount: '1.0' });

    // Advance another 800ms — total 1600ms but timer was reset, still only 1 instance
    jest.advanceTimersByTime(800);
    expect(instances).toHaveLength(1);

    // Now wait for the full timeout after the last message
    jest.advanceTimersByTime(201);
    expect(instances.length).toBeGreaterThanOrEqual(2);
  });

  it('uses the correct Horizon URL for the SSE endpoint', () => {
    let capturedUrl = '';
    const factory = (url: string): IEventSource => {
      capturedUrl = url;
      return new MockEventSource(url);
    };

    subscribeToPayments('GMERCHANT', jest.fn(), {
      horizonUrl: 'https://horizon.stellar.org',
      eventSourceFactory: factory,
    });

    expect(capturedUrl).toBe('https://horizon.stellar.org/payments?cursor=now');
  });
});
