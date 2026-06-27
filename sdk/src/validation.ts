import { LumenFlowError, PaymentErrorCode } from './errors';

const STELLAR_ADDRESS_REGEX = /^G[A-Z2-7]{55}$/;

export function isValidOrderId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isValidAddress(value: unknown): value is string {
  return typeof value === 'string' && STELLAR_ADDRESS_REGEX.test(value);
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
