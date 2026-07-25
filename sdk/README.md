# LumenFlow SDK

The LumenFlow TypeScript SDK provides a convenient wrapper around the LumenFlow smart contract.

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

---

## Multi-Network Configuration

The SDK ships with presets for `local`, `testnet`, and `mainnet`. Each preset
auto-populates the Soroban RPC URL, Horizon URL, and network passphrase.

### Quick start

```typescript
import { LumenFlowClient } from '@lumenflow/sdk';

// Connect to testnet using built-in defaults
const client = new LumenFlowClient({ network: 'testnet' });
console.log(client.network);          // 'testnet'
console.log(client.config.rpcUrl);    // 'https://soroban-testnet.stellar.org'
console.log(client.config.horizonUrl); // 'https://horizon-testnet.stellar.org'
```

### Switching networks

```typescript
// Local development
const local = new LumenFlowClient({ network: 'local' });

// Testnet
const testnet = new LumenFlowClient({ network: 'testnet' });

// Mainnet
const mainnet = new LumenFlowClient({ network: 'mainnet' });
```

### Custom URL overrides

Individual URLs can be overridden while keeping the rest of the preset:

```typescript
const client = new LumenFlowClient({
  network: 'testnet',
  rpcUrl: 'https://my-private-rpc.example.com', // override RPC only
  contractId: 'CABC1234567890',
});
```

### `getDefaultConfig` helper

```typescript
import { getDefaultConfig } from '@lumenflow/sdk';

const cfg = getDefaultConfig('mainnet');
// {
//   network: 'mainnet',
//   rpcUrl: 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc',
//   horizonUrl: 'https://horizon.stellar.org',
//   networkPassphrase: 'Public Global Stellar Network ; September 2015',
// }
```

### Network presets

| Network | RPC URL | Horizon URL |
|---|---|---|
| `local` | `http://localhost:8000/soroban/rpc` | `http://localhost:8000` |
| `testnet` | `https://soroban-testnet.stellar.org` | `https://horizon-testnet.stellar.org` |
| `mainnet` | `https://mainnet.stellar.validationcloud.io/v1/soroban/rpc` | `https://horizon.stellar.org` |
