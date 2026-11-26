import { LumenFlowError, LumenFlowValidationError, PaymentErrorCode } from './errors';

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

export function isValidOrderId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidAddress(value: unknown): value is string {
  return typeof value === 'string' && STELLAR_ADDRESS_REGEX.test(value);
}

export function assertNonEmptyString(value: unknown, field: string): string {
  if (!isValidOrderId(value)) {
    throw new LumenFlowValidationError(field, `${field} must be a non-empty string`);
  }
  return value;
}

export function assertPositiveAmount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new LumenFlowValidationError(field, `${field} must be a positive number`);
  }
  return value;
}

export function assertTokenAddress(value: unknown, field: string): string {
  if (!isValidAddress(value)) {
    throw new LumenFlowValidationError(field, `${field} must be a valid Stellar address`);
  }
  return value;
}

export function assertStellarAddress(value: unknown, field: string): string {
  if (!isValidAddress(value)) {
    throw new LumenFlowValidationError(field, `${field} must be a valid Stellar address`);
  }
  return value;
}

export function validateProcessPaymentInput(options: {
  orderId?: unknown;
  amount?: unknown;
  tokenAddress?: unknown;
}): void {
  assertNonEmptyString(options.orderId, 'orderId');
  assertPositiveAmount(options.amount, 'amount');
  assertTokenAddress(options.tokenAddress, 'tokenAddress');
}

export function validateRegisterMerchantInput(options: {
  name?: unknown;
  address?: unknown;
}): void {
  assertNonEmptyString(options.name, 'name');
  assertStellarAddress(options.address, 'address');
}

export function validateContractFields(options: {
  orderId?: unknown;
  tokenAddress?: unknown;
  payerAddress?: unknown;
  merchantAddress?: unknown;
}): void {
  if (options.orderId !== undefined && !isValidOrderId(options.orderId)) {
    throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'orderId must be a non-empty string');
  }

  if (options.tokenAddress !== undefined && !isValidAddress(options.tokenAddress)) {
    throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'tokenAddress must be a valid Stellar address');
  }

  if (options.payerAddress !== undefined && !isValidAddress(options.payerAddress)) {
    throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'payerAddress must be a valid Stellar address');
  }

  if (options.merchantAddress !== undefined && !isValidAddress(options.merchantAddress)) {
    throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'merchantAddress must be a valid Stellar address');
  }
}