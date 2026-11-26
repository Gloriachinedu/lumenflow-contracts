import { fetchContractEvents, pollContractEvents } from './eventPoller';
import { LumenFlowError, PaymentErrorCode } from './errors';

declare global {
  var fetch: jest.MockedFunction<typeof fetch>;
}

describe('fetchContractEvents', () => {
  const BASE = { rpcUrl: 'https://rpc.example.com', contractId: 'CONTRACT_ID' };

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('throws InvalidInput for missing rpcUrl', async () => {
    await expect(fetchContractEvents({ ...BASE, rpcUrl: '' })).rejects.toMatchObject({
      code: PaymentErrorCode.InvalidInput,
    });
  });

  it('throws InvalidInput for missing contractId', async () => {
    await expect(fetchContractEvents({ ...BASE, contractId: '' })).rejects.toMatchObject({
      code: PaymentErrorCode.InvalidInput,
    });
  });

  it('returns parsed event list from RPC', async () => {
    const event = { id: '1', type: 'contract', contractId: 'CONTRACT_ID', ledger: 42, topic: ['lumenflow', 'payment_processed', 'GMerchant'], value: ['ORDER_1', 'GPayer', 100] };
    global.fetch.mockResolvedValue({ json: async () => ({ result: { events: [event] } }) } as unknown as Response);

    const events = await fetchContractEvents(BASE);
    expect(events).toEqual([event]);
  });

  it('warns and discards malformed events by default', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation();
    global.fetch.mockResolvedValue({ json: async () => ({ result: { events: [{ type: 'contract' }] } }) } as unknown as Response);

    await expect(fetchContractEvents(BASE)).resolves.toEqual([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('throws on malformed events in strict mode', async () => {
    global.fetch.mockResolvedValue({ json: async () => ({ result: { events: [{ id: '1', type: 'contract', contractId: 'CONTRACT_ID', ledger: 42, topic: ['lumenflow'] }] } }) } as unknown as Response);

    await expect(fetchContractEvents({ ...BASE, strict: true })).rejects.toThrow('event name');
  });

  it('returns empty list when RPC result has no events', async () => {
    global.fetch.mockResolvedValue({ json: async () => ({ result: {} }) } as unknown as Response);
    const events = await fetchContractEvents(BASE);
    expect(events).toEqual([]);
  });

  it('rethrows network errors as LumenFlowError', async () => {
    global.fetch.mockRejectedValue(new Error('network failure'));

    await expect(fetchContractEvents(BASE)).rejects.toMatchObject({
      code: PaymentErrorCode.InvalidInput,
    });

    await expect(fetchContractEvents(BASE)).rejects.toThrow('network failure');
  });
});

describe('fetchContractEvents structured logging', () => {
  const BASE = { rpcUrl: 'https://rpc.example.com', contractId: 'CONTRACT_ID' };

  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    global.fetch = jest.fn();
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function parseLogLines(): Array<Record<string, unknown>> {
    return logSpy.mock.calls
      .map((call) => {
        try {
          return JSON.parse(call[0] as string) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  it('emits a JSON log line with level, correlationId, operation, duration_ms', async () => {
    global.fetch.mockResolvedValue({ json: async () => ({ result: { events: [] } }) } as unknown as Response);

    await fetchContractEvents(BASE);

    const lines = parseLogLines();
    expect(lines.length).toBeGreaterThan(0);
    const line = lines[lines.length - 1];
    expect(line).toHaveProperty('level');
    expect(line).toHaveProperty('correlationId');
    expect(line).toHaveProperty('operation');
    expect(line).toHaveProperty('duration_ms');
    expect(typeof line.duration_ms).toBe('number');
    expect(line.operation).toBe('fetchContractEvents');
  });

  it('auto-generates a UUID v4 correlation ID when none is provided', async () => {
    global.fetch.mockResolvedValue({ json: async () => ({ result: { events: [] } }) } as unknown as Response);

    await fetchContractEvents(BASE);

    const lines = parseLogLines();
    const line = lines[lines.length - 1];
    expect(typeof line.correlationId).toBe('string');
    expect(line.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('uses the caller-provided correlation ID', async () => {
    global.fetch.mockResolvedValue({ json: async () => ({ result: { events: [] } }) } as unknown as Response);

    const correlationId = '11111111-1111-4111-8111-111111111111';
    await fetchContractEvents({ ...BASE, correlationId });

    const lines = parseLogLines();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line.correlationId).toBe(correlationId);
    }
  });

  it('redacts sensitive fields in logged payloads', async () => {
    const secret = 'SEDU0000000000000000000000000000000000000000000000000000000000';
    global.fetch.mockResolvedValue({
      json: async () => ({
        result: {
          events: [
            {
              id: '1',
              type: 'contract',
              contractId: 'CONTRACT_ID',
              ledger: 42,
              topic: ['lumenflow', 'payment_processed', 'GMerchant'],
              value: ['ORDER_1', 'GPayer', 100],
              privateKey: secret,
            },
          ],
        },
      }),
    } as unknown as Response);

    await fetchContractEvents(BASE);

    const serialized = logSpy.mock.calls.map((call) => String(call[0])).join('\n');
    expect(serialized).not.toContain(secret);
    expect(serialized).toContain('[REDACTED]');
  });

  it('logs an error line with correlation ID when the RPC call fails', async () => {
    global.fetch.mockRejectedValue(new Error('network failure'));

    await expect(fetchContractEvents(BASE)).rejects.toBeInstanceOf(LumenFlowError);

    const lines = parseLogLines();
    const errorLine = lines.find((line) => line.level === 'error');
    expect(errorLine).toBeDefined();
    expect(errorLine).toHaveProperty('correlationId');
    expect(errorLine).toHaveProperty('operation', 'fetchContractEvents');
    expect(errorLine).toHaveProperty('duration_ms');
  });
});

describe('pollContractEvents', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns stop function that clears interval', async () => {
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ result: { events: [] } }) } as unknown as Response);
    const callback = jest.fn();
    const stop = pollContractEvents({ rpcUrl: 'https://rpc.example.com', contractId: 'CONTRACT_ID' }, 1000, callback);

    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(callback).toHaveBeenCalled();
    stop();
  });

  it('recovers and delivers events after a 30-second RPC outage', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    const event = { id: '1', type: 'contract', contractId: 'CONTRACT_ID', ledger: 42, topic: ['lumenflow', 'payment_processed', 'GMerchant'], value: ['ORDER_1', 'GPayer', 100] };

    let outageOver = false;
    global.fetch = jest.fn().mockImplementation(async () => {
      if (!outageOver) {
        throw new Error('RPC unavailable');
      }
      return { json: async () => ({ result: { events: [event] } }) } as unknown as Response;
    });

    const callback = jest.fn();
    const stop = pollContractEvents({ rpcUrl: 'https://rpc.example.com', contractId: 'CONTRACT_ID' }, 1000, callback);

    // Simulate a 30-second outage: every poll during this window fails.
    await jest.advanceTimersByTimeAsync(30_000);
    expect(callback).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledTimes(30);

    // RPC comes back online; the next poll should succeed and deliver events.
    outageOver = true;
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith([event]);

    // Polling continues to run after recovery.
    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(2);

    stop();
    errorSpy.mockRestore();
  });

  it('keeps polling after an RPC outage without stopping the interval', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    global.fetch = jest.fn().mockRejectedValue(new Error('RPC unavailable'));

    const callback = jest.fn();
    const stop = pollContractEvents({ rpcUrl: 'https://rpc.example.com', contractId: 'CONTRACT_ID' }, 1000, callback);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(global.fetch).toHaveBeenCalledTimes(30);
    expect(callback).not.toHaveBeenCalled();

    stop();
    errorSpy.mockRestore();
  });
});

describe('pollContractEvents structured logging', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ result: { events: [] } }) } as unknown as Response);
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });

  afterEach(() => {
    logSpy.mockRestore();
    jest.useRealTimers();
  });

  function parseLogLines(): Array<Record<string, unknown>> {
    return logSpy.mock.calls
      .map((call) => {
        try {
          return JSON.parse(call[0] as string) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is Record<string, unknown> => entry !== null);
  }

  it('emits structured log lines with correlation ID for each poll', async () => {
    const correlationId = '22222222-2222-4222-8222-222222222222';
    const stop = pollContractEvents(
      { rpcUrl: 'https://rpc.example.com', contractId: 'CONTRACT_ID', correlationId },
      1000,
      jest.fn(),
    );

    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    stop();

    const lines = parseLogLines();
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toHaveProperty('level');
      expect(line).toHaveProperty('operation');
      expect(line).toHaveProperty('duration_ms');
      expect(line.correlationId).toBe(correlationId);
    }
  });

  it('auto-generates a UUID v4 correlation ID for polling when none is provided', async () => {
    const stop = pollContractEvents(
      { rpcUrl: 'https://rpc.example.com', contractId: 'CONTRACT_ID' },
      1000,
      jest.fn(),
    );

    await jest.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    stop();

    const lines = parseLogLines();
    expect(lines.length).toBeGreaterThan(0);
    const line = lines[lines.length - 1];
    expect(line.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});