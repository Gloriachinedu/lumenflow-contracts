// Error handling
export {
  LumenFlowError,
  PaymentErrorCode,
  RateLimitError,
  SignatureError,
  NotFoundError,
  NetworkError,
} from './errors';

// Payment payload signing
export { buildPaymentPayload, signPaymentPayload, Keypair } from './signPaymentPayload';

// Wallet adapters
export { WalletAdapter, FreighterAdapter, KeypairAdapter, Keypair as AdapterKeypair } from './adapter';

// Address validation
export { isValidStellarAddress, isValidStellarContractId } from './adapter';

// Legacy wallet helpers (for backward compatibility)
export { connectFreighter, connectAlbedo, disconnectWallet, saveWallet, loadWallet, createFreighterAdapter } from './wallet';

// Pagination helpers
export { paginatePayments } from './payments';
export { paginateMerchants } from './merchants';

export * from "./client";
export * from "./types";
export * from "./errors";
export * from "./idempotency";
export * from "./signPaymentPayload";
export * from "./wallet";
export * from "./eventCatalog";
export * from "./security";
export * from "./lazyRoute";
export * from "./refundRecovery";