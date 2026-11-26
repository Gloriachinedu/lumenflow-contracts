import { callContract, normalizeContractError, loadContractWrapper } from './contractWrapper';
import { LumenFlowError, PaymentErrorCode } from './errors';

declare global {
  var fetch: jest.MockedFunction<typeof fetch>;
}

describe('lazy initialization', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('does not load the contract wrapper module until the first RPC call', async () => {
    const { loadContractWrapper: freshLoader } = await import('./contractWrapper');
    // Accessing the loader before any call must not trigger the dynamic import.
    expect(freshLoader).toBeDefined();
    // normalizeContractError is pure and must not load the wrapper.
    const error = normalizeContractError({ message: 'boom' });
    expect(error).toBeInstanceOf(LumenFlowError);
  });

  it('invokes the dynamic import exactly once across multiple calls (cached)', async () => {
    const { loadContractWrapper: freshLoader } = await import('./contractWrapper');
    const first = await freshLoader();
    const second = await freshLoader();
    const third = await freshLoader();
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it('reuses the loaded module for subsequent calls', async () => {
    const { loadContractWrapper: freshLoader } = await import('./contractWrapper');
    const loaded = await freshLoader();
    expect(loaded).toBeDefined();
    expect(typeof loaded.callContract).toBe('function');
  });

  it('exposes a shared loader instance from the module', async () => {
    const first = await loadContractWrapper();
    const second = await loadContractWrapper();
    expect(first).toBe(second);
  });
});

describe('normalizeContractError', () => {
  it('returns existing LumenFlowError unchanged', () => {
    const error = new LumenFlowError(PaymentErrorCode.PaymentAlreadyExists, 'duplicate');
    expect(normalizeContractError(error)).toBe(error);
  });

  it('maps a contract error object with numeric code', () => {
    const error = normalizeContractError({ code: 21, message: 'duplicate order' });
    expect(error).toBeInstanceOf(LumenFlowError);
    expect(error.code).toBe(PaymentErrorCode.PaymentAlreadyExists);
    expect(error.message).toContain('duplicate order');
  });

  it('wraps a generic object error as InvalidInput', () => {
    const error = normalizeContractError({ message: 'network failure' });
    expect(error.code).toBe(PaymentErrorCode.InvalidInput);
    expect(error.message).toContain('network failure');
  });
});

describe('callContract', () => {
  const BASE = { rpcUrl: 'https://rpc.example.com', method: 'invoke', params: { foo: 'bar' } };

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('throws InvalidInput for missing rpcUrl', async () => {
    await expect(callContract({ ...BASE, rpcUrl: '' })).rejects.toMatchObject({
      code: PaymentErrorCode.InvalidInput,
    });
  });

  it('throws InvalidInput for missing method', async () => {
    await expect(callContract({ ...BASE, method: '' })).rejects.toMatchObject({
      code: PaymentErrorCode.InvalidInput,
    });
  });

  it('throws InvalidInput for invalid params', async () => {
    await expect(callContract({ ...BASE, params: null as any })).rejects.toMatchObject({
      code: PaymentErrorCode.InvalidInput,
    });
  });

  it('throws normalized LumenFlowError for network failures', async () => {
    global.fetch.mockRejectedValue(new Error('network down'));
    await expect(callContract(BASE)).rejects.toMatchObject({
      code: PaymentErrorCode.InvalidInput,
      message: expect.stringContaining('network down'),
    });
  });

  it('throws normalized LumenFlowError for contract RPC errors', async () => {
    global.fetch.mockResolvedValue({
      json: async () => ({ error: { code: 21, message: 'duplicate order' } }),
    } as unknown as Response);
    await expect(callContract(BASE)).rejects.toMatchObject({
      code: PaymentErrorCode.PaymentAlreadyExists,
      message: expect.stringContaining('duplicate order'),
    });
  });

  it('returns result when RPC succeeds', async () => {
    global.fetch.mockResolvedValue({
      json: async () => ({ result: { success: true } }),
    } as unknown as Response);
    const response = await callContract(BASE);
    expect(response.result).toEqual({ success: true });
  });
});
