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
