# @lumenflow/sdk

LumenFlow TypeScript SDK — a lightweight Node.js / serverless wrapper for calling the LumenFlow Soroban smart contract.

## Installation

```bash
npm install @lumenflow/sdk
# or
yarn add @lumenflow/sdk
```

## Quick Start

```typescript
import { LumenFlowClient, NETWORKS } from "@lumenflow/sdk";

const client = new LumenFlowClient({
  contractId: "C...", // deployed contract address
  ...NETWORKS.testnet, // or NETWORKS.mainnet
});

// Read-only query — no keypair needed
const registered = await client.isRegistered("G...");
console.log("Is registered:", registered);

const merchant = await client.getMerchant("G...");
console.log("Merchant name:", merchant.name);
```

## Invoke (state-changing calls)

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
  await client.registerMerchant(source, address, ...);
} catch (err) {
  if (err instanceof LumenFlowError) {
    console.error(`[${err.code}] ${err.message}`);
    // err.messageKey → "error.merchantalreadyregistered" (for i18n)
  }
}
```

## API Reference

### `new LumenFlowClient(config)`

| Option | Type | Description |
|--------|------|-------------|
| `contractId` | `string` | Deployed contract address |
| `rpcUrl` | `string` | Soroban RPC endpoint URL |
| `networkPassphrase` | `string` | Stellar network passphrase |

Use `NETWORKS.testnet` or `NETWORKS.mainnet` as a spread to fill `rpcUrl` and `networkPassphrase`.

### Read-only methods (no keypair)

| Method | Returns | Description |
|--------|---------|-------------|
| `isRegistered(address)` | `Promise<boolean>` | Check if a merchant is registered |
| `getMerchant(address)` | `Promise<object>` | Get merchant details |
| `getPaymentSummary(orderId)` | `Promise<object>` | Get public payment summary |
| `query(method, ...args)` | `Promise<T>` | Call any read-only contract method |

### Invoke methods (requires `Keypair`)

| Method | Description |
|--------|-------------|
| `registerMerchant(source, address, name, desc, contact, category)` | Register a merchant |
| `processPayment(source, params)` | Process a payment with ed25519 signature |
| `invoke(source, method, ...args)` | Call any state-changing contract method |

## Development

```bash
# Build
npm run build

# Run tests (mocked RPC — no live node needed)
npm test
```

## Error Codes

See [`src/errors.ts`](src/errors.ts) for the full list of `PaymentErrorCode` values and their human-readable messages.
