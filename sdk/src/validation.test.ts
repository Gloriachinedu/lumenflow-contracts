import { validateContractFields, isValidAddress, isValidOrderId } from './validation';
import { LumenFlowError, PaymentErrorCode } from './errors';

describe('validateContractFields', () => {
  it('accepts valid orderId and addresses', () => {
    expect(() =>
      validateContractFields({
        orderId: 'ORDER_123',
        tokenAddress: 'GAF4FQF7WLE5BCU6O462YC52UR7734WGQOYZ6GSNH34BQGELQF7UTJ2Z',
        payerAddress: 'GA2WJ2YSKUZDYJWCXRB73R5OHM5LWZMRRR7K4D6YTIGAUMYCXRU77Z5F',
        merchantAddress: 'GA7K6FIQ2ULUN46H2VQ4X4ZQ7DG5EFZ4Z6VUCVPR67PW7SDYKP5UQK4W',
      }),
    ).not.toThrow();
  });

  it('throws for empty orderId', () => {
    expect(() => validateContractFields({ orderId: '' })).toThrow(LumenFlowError);
    expect(() => validateContractFields({ orderId: '' })).toThrow(
      expect.objectContaining({ code: PaymentErrorCode.InvalidInput }),
    );
  });

  it('throws for whitespace orderId', () => {
    expect(() => validateContractFields({ orderId: '   ' })).toThrow(LumenFlowError);
  });

  it('throws for invalid tokenAddress', () => {
    expect(() => validateContractFields({ tokenAddress: 'INVALID' })).toThrow(LumenFlowError);
    expect(() => validateContractFields({ tokenAddress: 'INVALID' })).toThrow(
      expect.objectContaining({ code: PaymentErrorCode.InvalidInput }),
    );
  });

  it('throws for invalid payerAddress', () => {
    expect(() => validateContractFields({ payerAddress: '123' })).toThrow(LumenFlowError);
  });

  it('throws for invalid merchantAddress', () => {
    expect(() => validateContractFields({ merchantAddress: 'XYZ' })).toThrow(LumenFlowError);
  });
});

describe('helper functions', () => {
  it('validates order id strings', () => {
    expect(isValidOrderId('ORDER_1')).toBe(true);
    expect(isValidOrderId('')).toBe(false);
    expect(isValidOrderId('   ')).toBe(false);
    expect(isValidOrderId(null)).toBe(false);
  });

  it('validates Stellar addresses', () => {
    expect(isValidAddress('GAF4FQF7WLE5BCU6O462YC52UR7734WGQOYZ6GSNH34BQGELQF7UTJ2Z')).toBe(true);
    expect(isValidAddress('C12345')).toBe(false);
    expect(isValidAddress('')).toBe(false);
    expect(isValidAddress(undefined)).toBe(false);
  });
});
