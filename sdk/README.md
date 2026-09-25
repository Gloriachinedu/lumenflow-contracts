# LumenFlow SDK

The LumenFlow TypeScript SDK provides a convenient wrapper around the LumenFlow smart contract.

## Error Handling

The SDK maps numeric contract error codes to human-readable English messages and provides a typed `LumenFlowError` object.

## Paginated payment history

Use `getAllPayments` to consume cursor-based history one page at a time. The generator stops when `next_cursor` is `null`, and breaking the loop stops further requests:

```typescript
for await (const payments of getAllPayments({ fetchPage })) {
  processPayments(payments);
}
```

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
