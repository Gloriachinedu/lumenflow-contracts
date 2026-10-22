import { LumenFlowError, ERROR_MESSAGES, PaymentErrorCode } from '../errors';

describe('LumenFlowError', () => {
  it('maps codes to messages', () => {
    const error = new LumenFlowError(PaymentErrorCode.PaymentAlreadyExists);
    expect(error.message).toBe(ERROR_MESSAGES[PaymentErrorCode.PaymentAlreadyExists]);
    expect(error.code).toBe(PaymentErrorCode.PaymentAlreadyExists);
  });

  it('returns a localization message key', () => {
    const error = new LumenFlowError(PaymentErrorCode.InvalidSignature);
    expect(error.messageKey).toBe('error.invalidsignature');
  });

  it('supports unknown error codes gracefully', () => {
    const unknownCode = 999 as PaymentErrorCode;
    const error = new LumenFlowError(unknownCode);
    expect(error.message).toContain('An unknown error occurred');
    expect(error.code).toBe(unknownCode);
  });
});
