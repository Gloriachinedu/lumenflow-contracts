export enum PaymentErrorCode {
  Unauthorized = 1,
  AdminAlreadySet = 2,
  InvalidAdminAddress = 3,
  MerchantNotFound = 10,
  MerchantAlreadyRegistered = 11,
  MerchantInactive = 12,
  PaymentNotFound = 20,
  PaymentAlreadyExists = 21,
  InvalidAmount = 22,
  InvalidSignature = 23,
  PaymentExpired = 24,
  InsufficientBalance = 25,
  RefundNotFound = 30,
  RefundAlreadyExists = 31,
  RefundWindowExpired = 32,
  RefundExceedsOriginal = 33,
  RefundNotApproved = 34,
  RefundAlreadyCompleted = 35,
  MultisigNotFound = 40,
  MultisigAlreadySigned = 41,
  MultisigAlreadyExecuted = 42,
  InsufficientSignatures = 43,
  InvalidInput = 50,
  PaginationLimitExceeded = 51,
  BatchSizeExceeded = 52,
}

export const ERROR_MESSAGES: Record<PaymentErrorCode, string> = {
  [PaymentErrorCode.Unauthorized]: "You are not authorized to perform this action.",
  [PaymentErrorCode.AdminAlreadySet]: "The contract admin has already been initialized.",
  [PaymentErrorCode.InvalidAdminAddress]: "The provided admin address is invalid (must be an account, not a contract).",
  [PaymentErrorCode.MerchantNotFound]: "The specified merchant could not be found.",
  [PaymentErrorCode.MerchantAlreadyRegistered]: "This address is already registered as a merchant.",
  [PaymentErrorCode.MerchantInactive]: "The merchant is currently inactive and cannot accept payments.",
  [PaymentErrorCode.PaymentNotFound]: "The specified payment record could not be found.",
  [PaymentErrorCode.PaymentAlreadyExists]: "A payment with this order ID already exists.",
  [PaymentErrorCode.InvalidAmount]: "The payment amount must be greater than zero.",
  [PaymentErrorCode.InvalidSignature]: "The provided signature is invalid or does not match the public key.",
  [PaymentErrorCode.PaymentExpired]: "The payment request has expired.",
  [PaymentErrorCode.InsufficientBalance]: "The payer has insufficient balance for this transaction.",
  [PaymentErrorCode.RefundNotFound]: "The specified refund record could not be found.",
  [PaymentErrorCode.RefundAlreadyExists]: "A refund with this ID already exists.",
  [PaymentErrorCode.RefundWindowExpired]: "The refund window (30 days) has expired for this payment.",
  [PaymentErrorCode.RefundExceedsOriginal]: "The refund amount exceeds the original payment amount.",
  [PaymentErrorCode.RefundNotApproved]: "The refund has not been approved by the merchant.",
  [PaymentErrorCode.RefundAlreadyCompleted]: "This refund has already been executed.",
  [PaymentErrorCode.MultisigNotFound]: "The specified multi-signature payment could not be found.",
  [PaymentErrorCode.MultisigAlreadySigned]: "This signer has already signed this payment.",
  [PaymentErrorCode.MultisigAlreadyExecuted]: "This multi-signature payment has already been executed.",
  [PaymentErrorCode.InsufficientSignatures]: "The payment does not have enough signatures to meet the threshold.",
  [PaymentErrorCode.InvalidInput]: "One or more input fields are invalid or empty.",
  [PaymentErrorCode.PaginationLimitExceeded]: "The requested page size exceeds the maximum limit.",
  [PaymentErrorCode.BatchSizeExceeded]: "The payment batch exceeds the maximum size (10 items).",
};

export class LumenFlowError extends Error {
  public readonly code: PaymentErrorCode;
  public readonly details?: any;

  constructor(code: PaymentErrorCode, details?: any) {
    const message = ERROR_MESSAGES[code] || `An unknown error occurred (code: ${code})`;
    super(message);
    this.name = "LumenFlowError";
    this.code = code;
    this.details = details;
  }

  /**
   * Localization-ready message key.
   */
  get messageKey(): string {
    return `error.${PaymentErrorCode[this.code].toLowerCase()}`;
  }
}
