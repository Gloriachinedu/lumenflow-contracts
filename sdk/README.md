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

## Real-Time Payment Notifications

`subscribeToPayments` opens a Horizon [Server-Sent Events](https://developers.stellar.org/docs/data/horizon/api-reference/resources/operations/object/payment) (SSE) stream for a merchant address and delivers strongly-typed `PaymentEvent` objects to a callback in real time.

- Lower latency than HTTP polling
- Automatic reconnection after 30 seconds of inactivity
- Cleanly closable via `unsubscribe()`

### Basic usage

```typescript
import { subscribeToPayments } from '@lumenflow/sdk';

const subscription = subscribeToPayments(
  'GABC...merchantAddress',           // Stellar merchant account
  (event) => {
    console.log('Payment received!');
    console.log('  From:    ', event.payer);
    console.log('  Amount:  ', event.amount.toString(), 'stroops');
    console.log('  Token:   ', event.token);
    console.log('  Order ID:', event.order_id);
  },
  {
    horizonUrl: 'https://horizon-testnet.stellar.org', // default: testnet
  },
);

// When you no longer need the subscription:
subscription.unsubscribe();
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `horizonUrl` | `string` | testnet URL | Horizon base URL |
| `inactivityTimeoutMs` | `number` | `30_000` | Reconnect after N ms of silence |
| `eventSourceFactory` | `EventSourceFactory` | Global `EventSource` | Override in tests or custom environments |

### PaymentEvent shape

```typescript
interface PaymentEvent {
  type: string;             // e.g. "payment"
  order_id: string;         // Horizon operation ID
  merchant_address: string; // "to" address
  payer: string;            // "from" address
  token: string;            // asset code or "native"
  amount: bigint;           // in stroops (1 XLM = 10_000_000 stroops)
  timestamp: bigint;        // Unix seconds
  raw: Record<string, unknown>; // full Horizon payload
}
```

### Testnet vs mainnet

```typescript
// Testnet
const sub = subscribeToPayments(merchant, callback, {
  horizonUrl: 'https://horizon-testnet.stellar.org',
});

// Mainnet
const sub = subscribeToPayments(merchant, callback, {
  horizonUrl: 'https://horizon.stellar.org',
});
```
