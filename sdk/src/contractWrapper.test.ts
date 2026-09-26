import { callContract, normalizeContractError } from './contractWrapper';
import { LumenFlowError, PaymentErrorCode } from './errors';

declare global {
  var fetch: jest.MockedFunction<typeof fetch>;
}

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
