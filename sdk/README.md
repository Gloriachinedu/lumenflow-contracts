# @lumenflow/sdk

TypeScript SDK for interacting with the LumenFlow Soroban smart contract on Stellar.

## Requirements

| Tool | Version |
|------|---------|
| Node.js | ≥ 18 |
| TypeScript | ≥ 5.0 |

## Installation

```bash
# npm
npm install @lumenflow/sdk

# yarn
yarn add @lumenflow/sdk

# pnpm
pnpm add @lumenflow/sdk
```

## Build

```bash
# Install dev dependencies first
npm install

# Compile TypeScript → dist/
npm run build
```

The compiled output lands in `dist/`.

## Testing

```bash
npm test
```

## Usage

```typescript
import { LumenFlowError, PaymentErrorCode } from '@lumenflow/sdk';

try {
  // Call a contract method via your Soroban RPC client...
} catch (error) {
  if (error.code) {
    const lfError = new LumenFlowError(error.code);
    console.error(lfError.message);      // human-readable message
    console.error(lfError.messageKey);   // i18n key, e.g. "error.paymentalreadyexists"
  }
}
```

### Error codes

All contract error codes are exported as the `PaymentErrorCode` enum:

```typescript
import { PaymentErrorCode } from '@lumenflow/sdk';

// e.g. PaymentErrorCode.Unauthorized === 1
```

## Error Handling

`LumenFlowError` wraps a numeric contract error code and exposes:

| Property | Type | Description |
|----------|------|-------------|
| `code` | `PaymentErrorCode` | Numeric error code |
| `message` | `string` | Human-readable English message |
| `messageKey` | `string` | i18n-ready key (e.g. `"error.unauthorized"`) |
| `details` | `any` | Optional raw error payload |

## License

MIT
