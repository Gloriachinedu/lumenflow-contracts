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
  TokenNotAllowed = 26,
  TooManyRefunds = 36,
  InvalidTags = 53,
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
  [PaymentErrorCode.TokenNotAllowed]: "The token is not allowed for payments.",
  [PaymentErrorCode.TooManyRefunds]: "The payment has reached its maximum number of refunds.",
  [PaymentErrorCode.InvalidTags]: "One or more payment tags are invalid.",
};

export class LumenFlowError extends Error {
  public readonly code: PaymentErrorCode;
  public readonly details?: unknown;

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

  toJSON() {
    return { name: this.name, code: this.code, message: this.message, ...(this.details === undefined ? {} : { details: this.details }) };
  }
}

abstract class ContractError extends LumenFlowError {
  protected constructor(code: PaymentErrorCode, details?: unknown) { super(code, details); }
}

export class UnauthorizedError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.Unauthorized, details); } }
export class AdminAlreadySetError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.AdminAlreadySet, details); } }
export class InvalidAdminAddressError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.InvalidAdminAddress, details); } }
export class MerchantNotFoundError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.MerchantNotFound, details); } }
export class MerchantAlreadyRegisteredError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.MerchantAlreadyRegistered, details); } }
export class MerchantInactiveError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.MerchantInactive, details); } }
export class PaymentNotFoundError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.PaymentNotFound, details); } }
export class PaymentAlreadyExistsError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.PaymentAlreadyExists, details); } }
export class InvalidAmountError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.InvalidAmount, details); } }
export class InvalidSignatureError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.InvalidSignature, details); } }
export class PaymentExpiredError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.PaymentExpired, details); } }
export class InsufficientBalanceError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.InsufficientBalance, details); } }
export class TokenNotAllowedError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.TokenNotAllowed, details); } }
export class RefundNotFoundError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.RefundNotFound, details); } }
export class RefundAlreadyExistsError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.RefundAlreadyExists, details); } }
export class RefundWindowExpiredError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.RefundWindowExpired, details); } }
export class RefundExceedsOriginalError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.RefundExceedsOriginal, details); } }
export class RefundNotApprovedError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.RefundNotApproved, details); } }
export class RefundAlreadyCompletedError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.RefundAlreadyCompleted, details); } }
export class TooManyRefundsError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.TooManyRefunds, details); } }
export class MultisigNotFoundError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.MultisigNotFound, details); } }
export class MultisigAlreadySignedError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.MultisigAlreadySigned, details); } }
export class MultisigAlreadyExecutedError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.MultisigAlreadyExecuted, details); } }
export class InsufficientSignaturesError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.InsufficientSignatures, details); } }
export class InvalidInputError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.InvalidInput, details); } }
export class PaginationLimitExceededError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.PaginationLimitExceeded, details); } }
export class BatchSizeExceededError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.BatchSizeExceeded, details); } }
export class InvalidTagsError extends ContractError { constructor(details?: unknown) { super(PaymentErrorCode.InvalidTags, details); } }

export const ERROR_TYPES: Record<PaymentErrorCode, new (details?: unknown) => LumenFlowError> = {
  [PaymentErrorCode.Unauthorized]: UnauthorizedError, [PaymentErrorCode.AdminAlreadySet]: AdminAlreadySetError, [PaymentErrorCode.InvalidAdminAddress]: InvalidAdminAddressError,
  [PaymentErrorCode.MerchantNotFound]: MerchantNotFoundError, [PaymentErrorCode.MerchantAlreadyRegistered]: MerchantAlreadyRegisteredError, [PaymentErrorCode.MerchantInactive]: MerchantInactiveError,
  [PaymentErrorCode.PaymentNotFound]: PaymentNotFoundError, [PaymentErrorCode.PaymentAlreadyExists]: PaymentAlreadyExistsError, [PaymentErrorCode.InvalidAmount]: InvalidAmountError,
  [PaymentErrorCode.InvalidSignature]: InvalidSignatureError, [PaymentErrorCode.PaymentExpired]: PaymentExpiredError, [PaymentErrorCode.InsufficientBalance]: InsufficientBalanceError, [PaymentErrorCode.TokenNotAllowed]: TokenNotAllowedError,
  [PaymentErrorCode.RefundNotFound]: RefundNotFoundError, [PaymentErrorCode.RefundAlreadyExists]: RefundAlreadyExistsError, [PaymentErrorCode.RefundWindowExpired]: RefundWindowExpiredError,
  [PaymentErrorCode.RefundExceedsOriginal]: RefundExceedsOriginalError, [PaymentErrorCode.RefundNotApproved]: RefundNotApprovedError, [PaymentErrorCode.RefundAlreadyCompleted]: RefundAlreadyCompletedError, [PaymentErrorCode.TooManyRefunds]: TooManyRefundsError,
  [PaymentErrorCode.MultisigNotFound]: MultisigNotFoundError, [PaymentErrorCode.MultisigAlreadySigned]: MultisigAlreadySignedError, [PaymentErrorCode.MultisigAlreadyExecuted]: MultisigAlreadyExecutedError, [PaymentErrorCode.InsufficientSignatures]: InsufficientSignaturesError,
  [PaymentErrorCode.InvalidInput]: InvalidInputError, [PaymentErrorCode.PaginationLimitExceeded]: PaginationLimitExceededError, [PaymentErrorCode.BatchSizeExceeded]: BatchSizeExceededError, [PaymentErrorCode.InvalidTags]: InvalidTagsError,
};

export function errorFromCode(code: number, details?: unknown): LumenFlowError {
  const ErrorType = ERROR_TYPES[code as PaymentErrorCode];
  return ErrorType ? new ErrorType(details) : new LumenFlowError(code as PaymentErrorCode, details);
}
