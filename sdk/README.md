# @lumenflow/sdk

TypeScript SDK for the LumenFlow Soroban smart contract on Stellar.

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

const keypair = Keypair.fromSecret('S...');
client.setSigner(async (tx) => {
  tx.sign(keypair);
  return tx;
});
```

---

## API Reference

### Configuration

#### `new LumenFlowClient(config: ClientConfig)`

| Parameter | Type | Description |
|---|---|---|
| `contractId` | `string` | Deployed contract address |
| `rpcUrl` | `string` | Soroban RPC endpoint URL |
| `networkPassphrase` | `string` | Stellar network passphrase |
| `signer` | `Signer?` | Optional transaction signing function |

#### `client.setSigner(signer: Signer): void`

Set or replace the signing function. Required for all state-changing operations.

```typescript
client.setSigner(async (tx) => {
  tx.sign(keypair);
  return tx;
});
```

---

### Admin

#### `setAdmin(admin: string): Promise<void>`

One-time admin initialisation. Fails if an admin is already set.

| Parameter | Type | Description |
|---|---|---|
| `admin` | `string` | Address to designate as contract administrator |

```typescript
await client.setAdmin(keypair.publicKey());
```

#### `transferAdmin(currentAdmin: string, newAdmin: string): Promise<void>`

Transfer admin rights to a new address.

```typescript
await client.transferAdmin(currentAdmin, newAdmin);
```

#### `setPaymentCleanupPeriod(admin: string, period: bigint): Promise<void>`

Set minimum age (seconds) before a payment is eligible for cleanup.

```typescript
await client.setPaymentCleanupPeriod(adminAddress, 7776000n); // 90 days
```

#### `setLargePaymentThreshold(admin: string, threshold: bigint): Promise<void>`

Set the threshold (in stroops) above which a payment triggers a suspicious-activity event.

```typescript
await client.setLargePaymentThreshold(adminAddress, 100_000_000n);
```

#### `setMaxRefundsPerOrder(admin: string, max: number): Promise<void>`

Set the maximum number of refunds allowed per order.

```typescript
await client.setMaxRefundsPerOrder(adminAddress, 5);
```

---

### Merchant Management

#### `registerMerchant(merchantAddress, name, description, contactInfo, category): Promise<void>`

Register a new merchant. The caller must be the merchant address.

| Parameter | Type | Description |
|---|---|---|
| `merchantAddress` | `string` | Merchant's Stellar address |
| `name` | `string` | Display name |
| `description` | `string` | Business description |
| `contactInfo` | `string` | Contact email or URL |
| `category` | `MerchantCategory` | One of `Retail`, `Food`, `Services`, `Digital`, `Other` |

```typescript
await client.registerMerchant(
  keypair.publicKey(),
  'My Store',
  'Best prices in town',
  'support@mystore.com',
  MerchantCategory.Retail,
);
```

#### `getMerchant(merchantAddress: string): Promise<Merchant>`

Retrieve merchant profile.

```typescript
const merchant = await client.getMerchant(merchantAddress);
console.log(merchant.name, merchant.verified, merchant.totalReceived);
```

**Returns:** [`Merchant`](#merchant)

#### `isRegistered(merchantAddress: string): Promise<boolean>`

Check whether an address has a registered merchant profile.

```typescript
const registered = await client.isRegistered(address);
```

#### `deactivateMerchant(admin: string, merchantAddress: string): Promise<void>`

Deactivate a merchant (admin only).

```typescript
await client.deactivateMerchant(adminAddress, merchantAddress);
```

#### `verifyMerchant(admin: string, merchantAddress: string): Promise<void>`

Mark a merchant as verified (admin only).

```typescript
await client.verifyMerchant(adminAddress, merchantAddress);
```

#### `unverifyMerchant(admin: string, merchantAddress: string): Promise<void>`

Remove merchant verification (admin only).

```typescript
await client.unverifyMerchant(adminAddress, merchantAddress);
```

---

### Payment Processing

#### `processPaymentWithSignature(payer, orderId, merchantAddress, tokenAddress, amount, memo, tags, signature, merchantPublicKey): Promise<void>`

Process a payment verified by an ed25519 merchant signature.

| Parameter | Type | Description |
|---|---|---|
| `payer` | `string` | Payer's Stellar address |
| `orderId` | `string` | Unique order identifier |
| `merchantAddress` | `string` | Merchant's Stellar address |
| `tokenAddress` | `string` | SAC token contract address |
| `amount` | `bigint` | Amount in stroops |
| `memo` | `string` | Payment memo |
| `tags` | `string[] \| null` | Optional tags |
| `signature` | `Buffer` | 64-byte ed25519 signature |
| `merchantPublicKey` | `Buffer` | 32-byte ed25519 public key |

```typescript
import { signPaymentPayload } from '@lumenflow/sdk';

const { signature, publicKey } = signPaymentPayload(
  merchantKeypair,
  orderId,
  merchantAddress,
  tokenAddress,
  amount,
);

await client.processPaymentWithSignature(
  payerAddress,
  'ORDER-001',
  merchantAddress,
  tokenAddress,
  10_000_000n,
  'Invoice #001',
  ['retail'],
  signature,
  publicKey,
);
```

#### `processPaymentWithNonce(payer, orderId, merchantAddress, tokenAddress, amount, memo, tags, nonce): Promise<void>`

Process a payment using a sequential nonce for replay protection.

| Parameter | Type | Description |
|---|---|---|
| `payer` | `string` | Payer's Stellar address |
| `orderId` | `string` | Unique order identifier |
| `merchantAddress` | `string` | Merchant's Stellar address |
| `tokenAddress` | `string` | SAC token contract address |
| `amount` | `bigint` | Amount in stroops |
| `memo` | `string` | Payment memo |
| `tags` | `string[] \| null` | Optional tags |
| `nonce` | `bigint` | Sequential nonce starting at `0`. Increment by 1 for each payment from this payer. Reuse is rejected with `InvalidNonce`. |

```typescript
// First payment: nonce = 0n
await client.processPaymentWithNonce(
  payerAddress,
  'ORDER-002',
  merchantAddress,
  tokenAddress,
  5_000_000n,
  'Coffee',
  null,
  0n,
);

// Second payment: nonce = 1n
await client.processPaymentWithNonce(
  payerAddress,
  'ORDER-003',
  merchantAddress,
  tokenAddress,
  5_000_000n,
  'Tea',
  null,
  1n,
);
```

**Nonce semantics:** The contract stores the next expected nonce per payer. Passing the current expected value succeeds and increments it. Any other value (lower or skipped) returns `InvalidNonce (4)`.

#### `batchPayment(payer: string, payments: BatchPaymentItem[]): Promise<void>`

Execute up to 10 signature-verified payments atomically. All succeed or all fail.

```typescript
await client.batchPayment(payerAddress, [
  {
    orderId: 'ORDER-010',
    merchantAddress,
    tokenAddress,
    amount: 1_000_000n,
    memo: 'Item A',
    signature: sig1,
    merchantPublicKey: pubKey,
  },
  {
    orderId: 'ORDER-011',
    merchantAddress,
    tokenAddress,
    amount: 2_000_000n,
    memo: 'Item B',
    signature: sig2,
    merchantPublicKey: pubKey,
  },
]);
```

#### `getPaymentById(caller: string, orderId: string): Promise<PaymentOrder>`

Retrieve full payment details. Caller must be the payer, merchant, or admin.

```typescript
const payment = await client.getPaymentById(callerAddress, 'ORDER-001');
console.log(payment.status, payment.amount, payment.refundedAmount);
```

**Returns:** [`PaymentOrder`](#paymentorder)

#### `getPaymentSummary(orderId: string): Promise<PaymentSummary>`

Retrieve a public summary of a payment (no auth required).

```typescript
const summary = await client.getPaymentSummary('ORDER-001');
```

**Returns:** [`PaymentSummary`](#paymentsummary)

#### `updatePaymentStatus(caller: string, orderId: string, refundedAmount: bigint): Promise<void>`

Update the refunded amount on a payment record. Caller must be merchant or admin.

```typescript
await client.updatePaymentStatus(merchantAddress, 'ORDER-001', 500_000n);
```

#### `archivePaymentRecord(admin: string, orderId: string): Promise<void>`

Remove a payment record from storage (admin only).

```typescript
await client.archivePaymentRecord(adminAddress, 'ORDER-001');
```

#### `cleanupExpiredPayments(admin: string): Promise<number>`

Delete all payment records older than the configured cleanup period. Returns the count removed.

```typescript
const removed = await client.cleanupExpiredPayments(adminAddress);
```

---

### Payment History Queries

#### `getMerchantPaymentHistory(merchant, cursor, limit, filter, sortField, sortOrder): Promise<PaymentPage>`

Retrieve paginated payment history for a merchant.

| Parameter | Type | Description |
|---|---|---|
| `merchant` | `string` | Merchant address |
| `cursor` | `string \| null` | Order ID to start from, or `null` for first page |
| `limit` | `number` | Max results (1–100) |
| `filter` | `PaymentFilter \| null` | Optional filter criteria |
| `sortField` | `SortField` | `Date` or `Amount` |
| `sortOrder` | `SortOrder` | `Ascending` or `Descending` |

```typescript
const page = await client.getMerchantPaymentHistory(
  merchantAddress,
  null,
  20,
  { status: StatusFilter.Completed },
  SortField.Date,
  SortOrder.Descending,
);

for (const p of page.payments) {
  console.log(p.orderId, p.amount);
}

// Fetch next page
if (page.nextCursor) {
  const next = await client.getMerchantPaymentHistory(
    merchantAddress,
    page.nextCursor,
    20,
    null,
    SortField.Date,
    SortOrder.Descending,
  );
}
```

**Returns:** [`PaymentPage`](#paymentpage)

#### `getPayerPaymentHistory(payer, cursor, limit, filter, sortField, sortOrder): Promise<PaymentPage>`

Retrieve paginated payment history for a payer. Same signature as `getMerchantPaymentHistory`.

```typescript
const page = await client.getPayerPaymentHistory(
  payerAddress,
  null,
  10,
  { amountMin: 1_000_000n, status: StatusFilter.Any },
  SortField.Amount,
  SortOrder.Ascending,
);
```

#### `getGlobalPaymentStats(admin, dateStart?, dateEnd?): Promise<GlobalStats>`

Retrieve platform-wide statistics (admin only).

```typescript
const stats = await client.getGlobalPaymentStats(
  adminAddress,
  1_700_000_000n, // optional Unix timestamp range
  1_720_000_000n,
);
console.log(stats.totalPayments, stats.totalVolume);
```

**Returns:** [`GlobalStats`](#globalstats)

---

### Refunds

#### `initiateRefund(caller, refundId, orderId, amount, reason): Promise<void>`

Open a refund request. Caller must be the payer or merchant.

| Parameter | Type | Description |
|---|---|---|
| `caller` | `string` | Payer or merchant address |
| `refundId` | `string` | Unique refund identifier |
| `orderId` | `string` | Order to refund |
| `amount` | `bigint` | Refund amount (≥ min refund amount, cumulative ≤ original amount) |
| `reason` | `string` | Reason for refund |

```typescript
await client.initiateRefund(
  payerAddress,
  'REFUND-001',
  'ORDER-001',
  5_000_000n,
  'Item not as described',
);
```

#### `approveRefund(caller: string, refundId: string): Promise<void>`

Approve a pending refund. Caller must be the merchant or admin.

```typescript
await client.approveRefund(merchantAddress, 'REFUND-001');
```

#### `rejectRefund(caller: string, refundId: string): Promise<void>`

Reject a pending refund. Caller must be the merchant or admin.

```typescript
await client.rejectRefund(merchantAddress, 'REFUND-001');
```

#### `executeRefund(refundId: string): Promise<void>`

Execute an approved refund (transfers tokens back to payer). Caller must be the merchant.

```typescript
await client.executeRefund('REFUND-001');
```

#### `getRefund(refundId: string): Promise<RefundRecord>`

Retrieve refund details.

```typescript
const refund = await client.getRefund('REFUND-001');
console.log(refund.status, refund.amount);
```

**Returns:** [`RefundRecord`](#refundrecord)

#### `disputeRefund(payer: string, refundId: string, evidence: string): Promise<void>`

Open a dispute on a rejected refund.

```typescript
await client.disputeRefund(payerAddress, 'REFUND-001', 'Proof of non-delivery attached');
```

#### `resolveDispute(admin: string, refundId: string, outcome: DisputeOutcome): Promise<void>`

Resolve a disputed refund (admin only).

```typescript
await client.resolveDispute(adminAddress, 'REFUND-001', DisputeOutcome.FavorPayer);
```

---

### Multi-Signature Payments

#### `initiateMultisigPayment(initiator, paymentId, merchantAddress, tokenAddress, amount, signers, requiredSignatures): Promise<void>`

Create a multisig payment requiring threshold approval before execution.

| Parameter | Type | Description |
|---|---|---|
| `initiator` | `string` | Address creating the payment |
| `paymentId` | `string` | Unique payment identifier |
| `merchantAddress` | `string` | Merchant to receive funds |
| `tokenAddress` | `string` | SAC token address |
| `amount` | `bigint` | Amount in stroops |
| `signers` | `string[]` | Authorised signer addresses (no duplicates) |
| `requiredSignatures` | `number` | Minimum signatures to execute |

```typescript
await client.initiateMultisigPayment(
  initiatorAddress,
  'MS-001',
  merchantAddress,
  tokenAddress,
  50_000_000n,
  [signer1, signer2, signer3],
  2, // 2-of-3
);
```

#### `signMultisigPayment(signer: string, paymentId: string, signature: Buffer): Promise<void>`

Add a signature to a pending multisig payment.

```typescript
await client.signMultisigPayment(signer1Address, 'MS-001', signatureBuffer);
```

#### `executeMultisigPayment(payer: string, paymentId: string): Promise<void>`

Execute a multisig payment once the signature threshold is met.

```typescript
await client.executeMultisigPayment(payerAddress, 'MS-001');
```

---

### Payment Requests

#### `createPaymentRequest(merchant, requestId, token, amount, memo, ttl): Promise<void>`

Create a time-limited payment request that a payer can fulfil.

| Parameter | Type | Description |
|---|---|---|
| `merchant` | `string` | Merchant address |
| `requestId` | `string` | Unique request identifier |
| `token` | `string` | SAC token address |
| `amount` | `bigint` | Amount in stroops |
| `memo` | `string` | Payment memo |
| `ttl` | `bigint` | Time-to-live in seconds |

```typescript
await client.createPaymentRequest(
  merchantAddress,
  'REQ-001',
  tokenAddress,
  25_000_000n,
  'Invoice #42',
  86400n, // 24 hours
);
```

#### `payPaymentRequest(payer: string, requestId: string): Promise<void>`

Fulfil a payment request.

```typescript
await client.payPaymentRequest(payerAddress, 'REQ-001');
```

---

### Subscriptions

#### `createSubscriptionPlan(merchant, planId, token, amount, intervalSecs, maxCycles): Promise<void>`

Create a recurring payment plan (merchant only).

```typescript
await client.createSubscriptionPlan(
  merchantAddress,
  'PLAN-MONTHLY',
  tokenAddress,
  10_000_000n,
  2_592_000n, // 30 days
  12,         // up to 12 charges
);
```

#### `subscribe(subscriber, subscriptionId, planId): Promise<void>`

Subscribe to a plan.

```typescript
await client.subscribe(subscriberAddress, 'SUB-001', 'PLAN-MONTHLY');
```

#### `chargeSubscription(subscriptionId: string): Promise<void>`

Trigger a charge cycle for a subscription (callable by anyone when the interval has elapsed).

```typescript
await client.chargeSubscription('SUB-001');
```

#### `cancelSubscription(subscriber: string, subscriptionId: string): Promise<void>`

Cancel an active subscription.

```typescript
await client.cancelSubscription(subscriberAddress, 'SUB-001');
```

---

### Utility: `signPaymentPayload`

Helper to build and sign the ed25519 payload expected by `processPaymentWithSignature`.

```typescript
import { signPaymentPayload } from '@lumenflow/sdk';
import { Keypair } from '@stellar/stellar-sdk';

const keypair = Keypair.fromSecret('S...');
const { signature, publicKey } = signPaymentPayload(
  keypair,
  orderId,
  merchantAddress,
  tokenAddress,
  amount,
);
```

---

## Types

### `Merchant`

```typescript
interface Merchant {
  address: string;
  name: string;
  description: string;
  contactInfo: string;
  category: MerchantCategory;
  active: boolean;
  verified: boolean;
  registeredAt: bigint;
  totalReceived: bigint;
}
```

### `PaymentOrder`

```typescript
interface PaymentOrder {
  orderId: string;
  merchantAddress: string;
  payer: string;
  token: string;
  amount: bigint;
  status: PaymentStatus;   // Completed | PartiallyRefunded | FullyRefunded
  paidAt: bigint;          // Unix timestamp
  refundedAmount: bigint;
  memo: string;
  tags?: string[];
  note?: string;
}
```

### `PaymentSummary`

```typescript
interface PaymentSummary {
  orderId: string;
  merchantAddress: string;
  amount: bigint;
  token: string;
  status: PaymentStatus;
  paidAt: bigint;
}
```

### `PaymentPage`

```typescript
interface PaymentPage {
  payments: PaymentOrder[];
  nextCursor?: string;  // null when no more pages
  total: number;        // total matching records before limit
}
```

### `PaymentFilter`

```typescript
interface PaymentFilter {
  dateStart?: bigint;   // Unix timestamp
  dateEnd?: bigint;
  amountMin?: bigint;
  amountMax?: bigint;
  token?: string;
  status: StatusFilter; // Any | Completed | PartiallyRefunded | FullyRefunded
  tag?: string;
}
```

### `RefundRecord`

```typescript
interface RefundRecord {
  refundId: string;
  orderId: string;
  initiator: string;
  amount: bigint;
  reason: string;
  status: RefundStatus; // Pending | Approved | Rejected | Completed | Disputed
  createdAt: bigint;
}
```

### `MultisigPayment`

```typescript
interface MultisigPayment {
  paymentId: string;
  merchantAddress: string;
  token: string;
  amount: bigint;
  requiredSignatures: number;
  signers: string[];
  signatures: Buffer[];
  signedBy: string[];
  executed: boolean;
  createdAt: bigint;
}
```

### `GlobalStats`

```typescript
interface GlobalStats {
  totalPayments: number;
  totalVolume: bigint;
  totalRefunds: number;
  totalRefundVolume: bigint;
  activeMerchants: number;
}
```

---

## Error Handling

Contract errors surface as `LumenFlowError` with a typed `code` property:

```typescript
import { LumenFlowError, PaymentErrorCode } from '@lumenflow/sdk';

try {
  await client.processPaymentWithNonce(/* ... */);
} catch (err) {
  if (err instanceof LumenFlowError) {
    switch (err.code) {
      case PaymentErrorCode.InvalidNonce:
        console.error('Nonce mismatch — fetch current nonce and increment by 1');
        break;
      case PaymentErrorCode.OrderAlreadyExists:
        console.error('Duplicate order ID');
        break;
      default:
        console.error(`Contract error ${err.code}: ${err.message}`);
    }
  }
}
```

See [`src/errors.ts`](src/errors.ts) for the full list of error codes.

---

## Development

```bash
# Build
npm run build

# Test
npm test
```
