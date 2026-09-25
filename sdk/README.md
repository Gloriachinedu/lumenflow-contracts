# LumenFlow SDK

The LumenFlow TypeScript SDK provides a convenient wrapper around the LumenFlow smart contract.

## Version and RPC diagnostics

The installed SDK version is available as `VERSION` for diagnostics and User-Agent metadata:

```typescript
import { LumenFlowClient, VERSION } from '@lumenflow/sdk';

console.log(VERSION);
const client = new LumenFlowClient('https://rpc.example', fetch);
```

RPC calls made by `LumenFlowClient` include the same value in the `X-SDK-Version` header.

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
