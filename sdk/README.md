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

## Retry Logic

The SDK provides `withRetry` — a configurable exponential backoff helper for wrapping any async RPC call.

### Retry Formula

```
delay = base * 2^attempt + random_jitter
```

### Retried conditions

| Condition | Retried? |
|---|---|
| Network error (no HTTP status) | ✅ Yes |
| HTTP 429 Too Many Requests | ✅ Yes |
| HTTP 503 Service Unavailable | ✅ Yes |
| HTTP 400 Bad Request | ❌ No |
| Any other 4xx client error | ❌ No |

### Usage

```typescript
import { withRetry } from '@lumenflow/sdk';

// Wrap any async call
const result = await withRetry(
  () => fetch('https://horizon.stellar.org/accounts/GABC...'),
  {
    maxRetries: 3,       // default: 3
    baseDelayMs: 200,    // default: 200 ms
    maxDelayMs: 10_000,  // default: 10 000 ms
    jitterMs: 100,       // default: 100 ms random jitter
  },
);
```

### Handling exhausted retries

When all retries are exhausted, `withRetry` throws a `RetryExhaustedError` containing:

- `message` — human-readable failure description
- `retryCount` — number of retries attempted
- `lastError` — the last error that caused the failure

```typescript
import { withRetry, RetryExhaustedError } from '@lumenflow/sdk';

try {
  const data = await withRetry(() => callRpc());
} catch (err) {
  const e = err as RetryExhaustedError;
  console.error(`Failed after ${e.retryCount} retries:`, e.lastError);
}
```
