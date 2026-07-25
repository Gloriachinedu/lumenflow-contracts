# LumenFlow SDK

The LumenFlow TypeScript SDK provides a convenient wrapper around the LumenFlow smart contract on Soroban.

## Installation

```bash
npm install @lumenflow/sdk
```

## Quick Start

```typescript
import { LumenFlowClient, MerchantCategory } from '@lumenflow/sdk';
import { Keypair } from '@stellar/stellar-sdk';

const client = new LumenFlowClient({
  contractId: 'CC...',
  rpcUrl: 'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
});

// Setup a signer for state-changing operations
const secretKey = 'S...';
const keypair = Keypair.fromSecret(secretKey);

client.setSigner(async (tx) => {
  tx.sign(keypair);
  return tx;
});

// Register a merchant
await client.registerMerchant(
  keypair.publicKey(),
  'My Shop',
  'The best shop',
  'contact@example.com',
  MerchantCategory.Retail
);

// Get merchant info
const merchant = await client.getMerchant(keypair.publicKey());
console.log(`Merchant ${merchant.name} registered at ${merchant.registeredAt}`);

// Process a payment
await client.processPaymentWithNonce(
  payerAddress,
  'ORDER-123',
  merchantAddress,
  tokenAddress,
  10000000n, // 1.0 unit (assuming 7 decimals)
  'Payment for coffee',
  ['coffee', 'morning'],
  0n // nonce
);
```

## Idempotent Payment Submission

`processPayment()` accepts an optional `idempotencyKey` parameter that prevents
double-submission under network retries or race conditions.

```typescript
// First call — hits the RPC node and executes the payment
await client.processPayment(
  payerAddress,
  'ORDER-123',
  merchantAddress,
  tokenAddress,
  10000000n,
  'Payment for coffee',
  null,
  0n,                  // nonce
  'idem-key-ORDER-123' // idempotency key
);

// Second call with the same key within 5 minutes — returns the
// cached result immediately without a new RPC call
await client.processPayment(
  payerAddress,
  'ORDER-123',
  merchantAddress,
  tokenAddress,
  10000000n,
  'Payment for coffee',
  null,
  0n,
  'idem-key-ORDER-123' // same key → cache hit, no network call
);
```

**How it works**

- The key is stored alongside its result and a 5-minute expiry timestamp in
  `sessionStorage` (browser) or an in-memory `Map` (Node.js / server-side).
- A duplicate call with the same key within the TTL returns the cached result
  without contacting the RPC node, guarding against double-charges on retry.
- After 5 minutes the entry expires and the next call will hit the network again.
- If the underlying call **throws**, the error is propagated and nothing is cached
  so the caller can safely retry with the same key.
- Omitting `idempotencyKey` disables caching entirely — the call always hits the
  network (matches the behaviour of `processPaymentWithNonce` directly).

The low-level cache helpers (`getCached`, `setCached`, `evictCached`,
`withIdempotency`) are exported from the package for advanced use-cases.

## Error Handling

The SDK maps numeric contract error codes to human-readable messages and provides a typed `LumenFlowError` object.

```typescript
import { LumenFlowError, PaymentErrorCode } from '@lumenflow/sdk';

try {
  await client.registerMerchant(...);
} catch (error) {
  if (error instanceof LumenFlowError) {
    console.error(`Error ${error.code}: ${error.message}`);
    // e.g., "Error 11: This address is already registered as a merchant."
  }
}
```

## Features

- **Full Coverage:** Supports all 39 contract functions including Admin, Merchant, Payment, Refunds, Multisig, and Subscriptions.
- **Type Safety:** Fully typed interfaces for all contract data structures.
- **Automatic XDR Handling:** Converts between JS types (bigint, number, string) and Soroban ScVal automatically.
- **Error Mapping:** Direct mapping from Soroban contract errors to descriptive SDK errors.
- **Utility Functions:** Includes helpers for signing payment payloads off-chain.

## Development

### Build
```bash
npm run build
```

### Test
```bash
npm test
```
