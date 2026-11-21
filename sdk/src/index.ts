// Error handling
export { LumenFlowError, PaymentErrorCode } from './errors';

// Payment payload signing
export { buildPaymentPayload, signPaymentPayload, Keypair } from './signPaymentPayload';

// Wallet adapters
export { WalletAdapter, FreighterAdapter, KeypairAdapter, Keypair as AdapterKeypair } from './adapter';

// Address validation
export { isValidStellarAddress, isValidStellarContractId } from './adapter';

// Legacy wallet helpers (for backward compatibility)
export { connectFreighter, connectAlbedo, disconnectWallet, saveWallet, loadWallet, createFreighterAdapter } from './wallet';
export * from "./client";
export * from "./types";
export * from "./errors";
export * from "./idempotency";
export * from "./signPaymentPayload";
export * from "./wallet";
export * from "./idempotency";
export * from "./eventCatalog";
export * from "./security";
export * from "./lazyRoute";
export * from "./refundRecovery";

// Fee module (configurable recipient and basis points)
export type { FeeConfig, SetFeeConfigParams } from './types';
export { setFeeConfig, getFeeConfig } from './client';

// Cross-asset payment support (Stellar DEX path conversion)
export type {
  CrossAssetPaymentParams,
  CrossAssetPaymentEvent,
  PathPaymentPayload,
} from './types';
export { processPaymentCrossAsset, buildPathPaymentPayload } from './client';