/**
 * LumenFlow TypeScript SDK
 *
 * Main entry point — re-exports all public types and utilities.
 */

// Types
export type {
  Option,
  Vec,
  MerchantCategory,
  Merchant,
  PaymentStatus,
  PaymentOrder,
  PaymentSummary,
  PaymentRequest,
  BatchPaymentItem,
  RefundStatus,
  RefundRecord,
  DisputeOutcome,
  DisputeRecord,
  MultisigPayment,
  SortField,
  SortOrder,
  StatusFilter,
  PaymentFilter,
  PaymentPage,
  GlobalStats,
  MerchantStats,
  SuspiciousActivityReason,
  SubscriptionStatus,
  SubscriptionPlan,
  Subscription,
  PaymentEvent,
} from './types';

// Errors
export { LumenFlowError, PaymentErrorCode, ERROR_MESSAGES } from './errors';

// Signing utilities
export { buildPaymentPayload, signPaymentPayload } from './signPaymentPayload';
export type { Keypair } from './signPaymentPayload';

// Wallet adapters
export {
  saveWallet,
  loadWallet,
  connectFreighter,
  connectAlbedo,
  disconnectWallet,
} from './wallet';
export type { WalletInfo } from './wallet';
