# @lumenflow/sdk

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

## Error Handling

The SDK maps numeric contract error codes to human-readable messages and provides a typed `LumenFlowError` object.

```typescript
import { LumenFlowClient, NETWORKS } from "@lumenflow/sdk";
import { Keypair } from "@stellar/stellar-sdk";

const client = new LumenFlowClient({
  contractId: process.env.CONTRACT_ID!,
  ...NETWORKS.testnet,
});

const source = Keypair.fromSecret(process.env.SOURCE_SECRET!);

await client.registerMerchant(
  source,
  source.publicKey(),
  "My Store",
  "A great store",
  "contact@store.com",
  "Retail"
);
```

## Error Handling

Contract errors are surfaced as `LumenFlowError` with a typed `code` property:

```typescript
import { LumenFlowError, PaymentErrorCode } from "@lumenflow/sdk";

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

## Rate Limiting

The LumenFlow SDK communicates with Stellar Horizon and Soroban RPC endpoints. Both are subject to rate limits. The SDF public Horizon instance allows **3 600 requests per hour per IP** in standard REST mode, and up to **100 events/second** on Server-Sent Events streaming connections.

When a limit is exceeded Horizon responds with **HTTP 429 Too Many Requests** and a `Retry-After` header indicating how many seconds to wait before retrying.

### Built-in retry logic

The SDK includes a production-ready exponential backoff helper in [`src/retry.ts`](src/retry.ts) that is applied automatically to all RPC read operations performed through `LumenFlowClient`. The default policy retries up to **3 attempts** with a base delay of **200 ms**, capped at **5 000 ms**, and **20% jitter** to avoid thundering-herd behaviour.

You can override the retry policy per call:

```typescript
const merchant = await client.getMerchant(address, {
  maxAttempts: 5,
  baseDelayMs: 500,
  maxDelayMs: 15_000,
  jitter: 0.3,
});
```

The `withRetry` helper can also be used directly for custom Horizon queries:

```typescript
import { withRetry } from '@lumenflow/sdk/retry';

const stats = await withRetry(
  () => fetch('https://horizon-testnet.stellar.org/fee_stats').then(r => r.json()),
  { maxAttempts: 4, baseDelayMs: 300 }
);
```

Errors that are automatically retried: `TypeError` (network failure), HTTP 408, 429, 500, 502, 503, 504. `LumenFlowError` contract errors are **not** retried and propagate immediately.

For full documentation on Horizon rate limits, `Retry-After` header handling, and a standalone exponential backoff implementation, see **[docs/api-rate-limits.md](../docs/api-rate-limits.md)**.

## Development

### Build
```bash
npm run build
```

### Test
```bash
npm test
```

## Error Codes

See [`src/errors.ts`](src/errors.ts) for the full list of `PaymentErrorCode` values and their human-readable messages.
