# LumenFlow SDK

The LumenFlow TypeScript SDK provides a convenient wrapper around the LumenFlow smart contract.

## Installation

```bash
npm install @lumenflow/sdk
```

## Development

To build the SDK from source:

```bash
cd sdk
npm install
npm run build
npm test
```

## Error Handling

The SDK maps numeric contract error codes to human-readable English messages and provides a typed `LumenFlowError` object.

### Usage

```typescript
import { LumenFlowError, PaymentErrorCode } from '@lumenflow/sdk';

try {
  // Call contract...
} catch (error) {
  if (error.code) {
    const lfError = new LumenFlowError(error.code);
    console.error(lfError.message); // "A payment with this order ID already exists."
    
    // For localization (e.g. in a dashboard):
    const translationKey = lfError.messageKey; // "error.paymentalreadyexists"
    // useTranslation(translationKey);
  }
}
```

### Toast Notification Example

```typescript
function handleContractError(error: any) {
  const lfError = new LumenFlowError(error.code || 50);
  toast.error(lfError.message, {
    description: `Error Code: ${lfError.code}`,
  });
}
```

## Wallet Adapters

The SDK provides a `WalletAdapter` interface that decouples signing logic from the SDK core. This allows the SDK to work in browser environments (using wallet extensions like Freighter) as well as server-side or CLI environments (using raw keypairs).

### Built-in Adapters

#### FreighterAdapter

For browser-based applications using the Freighter wallet extension:

```typescript
import { FreighterAdapter, WalletAdapter } from '@lumenflow/sdk';

const adapter: WalletAdapter = new FreighterAdapter();

if (adapter.isConnected()) {
  const publicKey = await adapter.getPublicKey();
  const signature = await adapter.signTransaction(payload);
}
```

#### KeypairAdapter

For CLI tools, server-side applications, or testing:

```typescript
import { KeypairAdapter, WalletAdapter } from '@lumenflow/sdk';

// Generate a new random keypair
const adapter: WalletAdapter = KeypairAdapter.generate();

// Or create from an existing secret key
const secretKey = Buffer.from('your-secret-key-hex', 'hex');
const adapter: WalletAdapter = KeypairAdapter.fromSecretKey(secretKey);

const publicKey = await adapter.getPublicKey();
const signature = await adapter.signTransaction(payload);
```

### Implementing a Custom Adapter

You can implement your own wallet adapter by implementing the `WalletAdapter` interface:

```typescript
import { WalletAdapter } from '@lumenflow/sdk';

class CustomWalletAdapter implements WalletAdapter {
  async getPublicKey(): Promise<string> {
    // Return your wallet's public key as a hex string
    return 'your-public-key-hex';
  }

  async signTransaction(payload: Buffer | Uint8Array): Promise<Buffer | Uint8Array> {
    // Sign the payload using your wallet's signing mechanism
    // Return the signature as a Buffer or Uint8Array
    return Buffer.from('your-signature');
  }

  isConnected(): boolean {
    // Return true if your wallet is connected/available
    return true;
  }
}
```

### Payment Payload Signing

The SDK also provides utilities for building and signing payment payloads:

```typescript
import { buildPaymentPayload, signPaymentPayload, KeypairAdapter } from '@lumenflow/sdk';

// Build the exact payload that the LumenFlow contract verifies
const payload = buildPaymentPayload('ORDER_001', 1000n);

// Sign with a keypair adapter
const adapter = KeypairAdapter.generate();
const signature = await adapter.signTransaction(payload);

// Or use the direct signing function
const keypair = {
  publicKey: Buffer.from('public-key'),
  secretKey: Buffer.from('secret-key'),
};
const signature = signPaymentPayload('ORDER_001', 1000n, keypair);
```

## Address Validation

For frontend applications, the SDK provides utilities to validate Stellar addresses:

```typescript
import { isValidStellarAddress, isValidStellarContractId } from '@lumenflow/sdk';

// Validate a Stellar public key (G-address)
const isValid = isValidStellarAddress('GD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');
console.log(isValid); // true

// Validate a Stellar contract ID (C-address)
const isContractValid = isValidStellarContractId('CD6WUVRX7XJ6E5Q5K2L2K3K4K5K6K7K8K9K0K1K2K3K4K5K6K7K8K9K0K1K2');
console.log(isContractValid); // true
```

### Validation Rules

- **Stellar Public Keys (G-address)**: Must start with 'G', be exactly 56 characters, and use valid base32 encoding
- **Stellar Contract IDs (C-address)**: Must start with 'C', be exactly 56 characters, and use valid base32 encoding

**Note**: The validation functions perform lightweight format checking. For production use with full checksum validation, consider using `@stellar/stellar-sdk`'s `StrKey` utilities:

```typescript
import { StrKey } from '@stellar/stellar-sdk';

try {
  StrKey.decodeEd25519PublicKey(address);
  // Valid address
} catch {
  // Invalid address
}
```

## Retry Configuration

The SDK provides automatic retry logic for transient HTTP errors (429, 503, 504, network failures) when using the `Client` class.

### Default Retry Configuration

```typescript
import { DEFAULT_RETRY_CONFIG } from '@lumenflow/sdk';

console.log(DEFAULT_RETRY_CONFIG);
// {
//   maxAttempts: 5,
//   initialDelayMs: 100,
//   maxDelayMs: 10000,
//   backoffMultiplier: 2,
//   jitterFactor: 0.1,
//   retryableStatusCodes: [429, 503, 504],
// }
```

### Using the Client with Custom Retry Config

```typescript
import { Client, ClientConfig } from '@lumenflow/sdk';

const config: ClientConfig = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  contractId: 'your-contract-id',
  retryConfig: {
    maxAttempts: 10,           // Increase max attempts
    initialDelayMs: 200,       // Start with longer delay
    maxDelayMs: 30000,          // Allow longer max delay
  },
};

const client = new Client(config);
```

### Retry Behavior

- **Transient errors** (429, 503, 504, network failures) are automatically retried with exponential backoff and jitter
- **Business logic errors** (`LumenFlowError`) are not retried and propagate immediately
- **Non-retryable HTTP errors** (400, 401, 403, etc.) are not retried

### Manual Retry

You can also use the `withRetry` utility directly:

```typescript
import { withRetry, RetryConfig } from '@lumenflow/sdk';

const config: Partial<RetryConfig> = {
  maxAttempts: 3,
  initialDelayMs: 100,
};

await withRetry(async () => {
  // Your async operation here
  await someApiCall();
}, config);
```
