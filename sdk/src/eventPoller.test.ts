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
});
