export enum PaymentErrorCode {
  Unauthorized = 1,
  AdminAlreadySet = 2,
  InvalidAdminAddress = 3,
  InvalidNonce = 4,
  MerchantNotFound = 10,
  MerchantAlreadyRegistered = 11,
  MerchantInactive = 12,
  PaymentNotFound = 20,
  PaymentAlreadyExists = 21,
  InvalidAmount = 22,
  InvalidSignature = 23,
  PaymentExpired = 24,
  InsufficientBalance = 25,
  TokenNotAllowed = 26,
  RefundNotFound = 30,
  RefundAlreadyExists = 31,
  RefundWindowExpired = 32,
  RefundExceedsOriginal = 33,
  RefundNotApproved = 34,
  RefundAlreadyCompleted = 35,
  TooManyRefunds = 36,
  RefundNotRejected = 37,
  DisputeAlreadyExists = 38,
  DisputeNotFound = 39,
  MultisigNotFound = 40,
  MultisigAlreadySigned = 41,
  MultisigAlreadyExecuted = 42,
  InsufficientSignatures = 43,
  MultisigAlreadyCancelled = 44,
  InvalidInput = 50,
  PaginationLimitExceeded = 51,
  BatchSizeExceeded = 52,
  InvalidTags = 53,
  SubscriptionPlanAlreadyExists = 60,
  SubscriptionAlreadyExists = 61,
  SubscriptionPlanNotFound = 62,
  SubscriptionNotFound = 63,
  SubscriptionNotActive = 64,
  SubscriptionMaxCyclesReached = 65,
  SubscriptionIntervalNotElapsed = 66,
}

export const ERROR_MESSAGES: Record<PaymentErrorCode, string> = {
  [PaymentErrorCode.Unauthorized]: "You are not authorized to perform this action.",
  [PaymentErrorCode.AdminAlreadySet]: "The contract admin has already been initialized.",
  [PaymentErrorCode.InvalidAdminAddress]: "The provided admin address is invalid (must be an account, not a contract).",
  [PaymentErrorCode.InvalidNonce]: "The provided nonce does not match the expected value.",
  [PaymentErrorCode.MerchantNotFound]: "The specified merchant could not be found.",
  [PaymentErrorCode.MerchantAlreadyRegistered]: "This address is already registered as a merchant.",
  [PaymentErrorCode.MerchantInactive]: "The merchant is currently inactive and cannot accept payments.",
  [PaymentErrorCode.PaymentNotFound]: "The specified payment record could not be found.",
  [PaymentErrorCode.PaymentAlreadyExists]: "A payment with this order ID already exists.",
  [PaymentErrorCode.InvalidAmount]: "The payment amount must be greater than zero.",
  [PaymentErrorCode.InvalidSignature]: "The provided signature is invalid or does not match the public key.",
  [PaymentErrorCode.PaymentExpired]: "The payment request has expired.",
  [PaymentErrorCode.InsufficientBalance]: "The payer has insufficient balance for this transaction.",
  [PaymentErrorCode.TokenNotAllowed]: "The specified token is not accepted by the contract.",
  [PaymentErrorCode.RefundNotFound]: "The specified refund record could not be found.",
  [PaymentErrorCode.RefundAlreadyExists]: "A refund with this ID already exists.",
  [PaymentErrorCode.RefundWindowExpired]: "The refund window (30 days) has expired for this payment.",
  [PaymentErrorCode.RefundExceedsOriginal]: "The refund amount exceeds the original payment amount.",
  [PaymentErrorCode.RefundNotApproved]: "The refund has not been approved by the merchant.",
  [PaymentErrorCode.RefundAlreadyCompleted]: "This refund has already been executed.",
  [PaymentErrorCode.TooManyRefunds]: "The maximum number of partial refunds for this order has been reached.",
  [PaymentErrorCode.RefundNotRejected]: "The refund cannot be disputed because it was not rejected.",
  [PaymentErrorCode.DisputeAlreadyExists]: "A dispute already exists for this refund.",
  [PaymentErrorCode.DisputeNotFound]: "The requested dispute was not found.",
  [PaymentErrorCode.MultisigNotFound]: "The specified multi-signature payment could not be found.",
  [PaymentErrorCode.MultisigAlreadySigned]: "This signer has already signed this payment.",
  [PaymentErrorCode.MultisigAlreadyExecuted]: "This multi-signature payment has already been executed.",
  [PaymentErrorCode.InsufficientSignatures]: "The payment does not have enough signatures to meet the threshold.",
  [PaymentErrorCode.MultisigAlreadyCancelled]: "This multi-signature payment has been cancelled.",
  [PaymentErrorCode.InvalidInput]: "One or more input fields are invalid or empty.",
  [PaymentErrorCode.PaginationLimitExceeded]: "The requested page size exceeds the maximum limit.",
  [PaymentErrorCode.BatchSizeExceeded]: "The payment batch exceeds the maximum size (10 items).",
  [PaymentErrorCode.InvalidTags]: "The provided tags exceed length or count limits.",
  [PaymentErrorCode.SubscriptionPlanAlreadyExists]: "A subscription plan with this ID already exists.",
  [PaymentErrorCode.SubscriptionAlreadyExists]: "A subscription with this ID already exists.",
  [PaymentErrorCode.SubscriptionPlanNotFound]: "The specified subscription plan could not be found.",
  [PaymentErrorCode.SubscriptionNotFound]: "The specified subscription could not be found.",
  [PaymentErrorCode.SubscriptionNotActive]: "The subscription is not active.",
  [PaymentErrorCode.SubscriptionMaxCyclesReached]: "The subscription has reached its maximum charging cycles.",
  [PaymentErrorCode.SubscriptionIntervalNotElapsed]: "The required interval between charges has not elapsed.",
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
