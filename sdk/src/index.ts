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

// Payment link generation
export { generatePaymentLink, PaymentLinkOptions, PaymentLinkError } from "./paymentLink";
```

Note: The `generatePaymentLink` helper is implemented in `sdk/src/paymentLink.ts` and re-exported here. The helper builds a `/pay?merchant=X&amount=Y&memo=Z` URL from a typed options object, validating the required `merchant` and optional `amount`/`memo`. Unit tests live in `sdk/src/paymentLink.test.ts` covering valid links, omitted optional params, and invalid input.