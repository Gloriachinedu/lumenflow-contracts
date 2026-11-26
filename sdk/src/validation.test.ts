import {
  validateContractFields,
  isValidAddress,
  isValidOrderId,
  validateOrderId,
  validateAmount,
  validateTokenAddress,
  validateMerchantName,
  validateStellarAddress,
} from './validation';
import { LumenFlowError, LumenFlowValidationError, PaymentErrorCode } from './errors';

const VALID_TOKEN = 'GAF4FQF7WLE5BCU6O462YC52UR7734WGQOYZ6GSNH34BQGELQF7UTJ2Z';
const VALID_ADDRESS = 'GA2WJ2YSKUZDYJWCXRB73R5OHM5LWZMRRR7K4D6YTIGAUMYCXRU77Z5F';

function expectValidationError(fn: () => unknown, field: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(LumenFlowValidationError);
  expect(caught).toBeInstanceOf(LumenFlowError);
  expect((caught as LumenFlowValidationError).field).toBe(field);
  expect((caught as LumenFlowValidationError).code).toBe(PaymentErrorCode.InvalidInput);
}

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

describe('validateOrderId', () => {
  it('accepts a non-empty string', () => {
    expect(() => validateOrderId('ORDER_123')).not.toThrow();
  });

  it('rejects empty, whitespace, and non-string values', () => {
    expectValidationError(() => validateOrderId(''), 'orderId');
    expectValidationError(() => validateOrderId('   '), 'orderId');
    expectValidationError(() => validateOrderId(undefined as unknown as string), 'orderId');
    expectValidationError(() => validateOrderId(null as unknown as string), 'orderId');
    expectValidationError(() => validateOrderId(123 as unknown as string), 'orderId');
  });
});

describe('validateAmount', () => {
  it('accepts positive numbers and bigints', () => {
    expect(() => validateAmount(1)).not.toThrow();
    expect(() => validateAmount(0.5)).not.toThrow();
    expect(() => validateAmount(BigInt(10))).not.toThrow();
  });

  it('rejects zero, negative, NaN, and non-number values', () => {
    expectValidationError(() => validateAmount(0), 'amount');
    expectValidationError(() => validateAmount(-1), 'amount');
    expectValidationError(() => validateAmount(BigInt(0)), 'amount');
    expectValidationError(() => validateAmount(BigInt(-5)), 'amount');
    expectValidationError(() => validateAmount(NaN), 'amount');
    expectValidationError(() => validateAmount('10' as unknown as number), 'amount');
    expectValidationError(() => validateAmount(undefined as unknown as number), 'amount');
  });
});

describe('validateTokenAddress', () => {
  it('accepts a valid Stellar address', () => {
    expect(() => validateTokenAddress(VALID_TOKEN)).not.toThrow();
  });

  it('rejects malformed and empty addresses', () => {
    expectValidationError(() => validateTokenAddress('INVALID'), 'tokenAddress');
    expectValidationError(() => validateTokenAddress('C12345'), 'tokenAddress');
    expectValidationError(() => validateTokenAddress(''), 'tokenAddress');
    expectValidationError(() => validateTokenAddress(undefined as unknown as string), 'tokenAddress');
  });
});

describe('validateMerchantName', () => {
  it('accepts a non-empty name', () => {
    expect(() => validateMerchantName('Acme Store')).not.toThrow();
  });

  it('rejects empty, whitespace, and non-string names', () => {
    expectValidationError(() => validateMerchantName(''), 'name');
    expectValidationError(() => validateMerchantName('   '), 'name');
    expectValidationError(() => validateMerchantName(undefined as unknown as string), 'name');
    expectValidationError(() => validateMerchantName(42 as unknown as string), 'name');
  });
});

describe('validateStellarAddress', () => {
  it('accepts a valid Stellar address', () => {
    expect(() => validateStellarAddress(VALID_ADDRESS, 'address')).not.toThrow();
  });

  it('rejects malformed and empty addresses with the given field name', () => {
    expectValidationError(() => validateStellarAddress('INVALID', 'address'), 'address');
    expectValidationError(() => validateStellarAddress('', 'address'), 'address');
    expectValidationError(() => validateStellarAddress(undefined as unknown as string, 'address'), 'address');
    expectValidationError(() => validateStellarAddress('XYZ', 'merchantAddress'), 'merchantAddress');
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
