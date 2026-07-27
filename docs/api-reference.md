# LumenFlow Contract API Reference

This document describes the string parameter constraints and validation rules for all LumenFlow smart contract functions.

## String Length Constraints

All string parameters in the contract enforce minimum and maximum length limits. These limits prevent ledger storage bloat and ensure consistent behavior. Strings exceeding their maximum length will result in an `InvalidInput` error (code `50`).

| Parameter | Minimum | Maximum | Used In |
|-----------|---------|---------|---------|
| `name` | 1 | 64 | `register_merchant` |
| `description` | 1 | 256 | `register_merchant` |
| `contact_info` | 1 | 128 | `register_merchant` |
| `memo` | 0 | 128 | `process_payment_with_signature`, `batch_payment`, `process_payment_with_nonce`, `create_payment_request` |
| `reason` | 1 | 256 | `initiate_refund` |
| `order_id` | 1 | 64 | `process_payment_with_signature`, `batch_payment`, `process_payment_with_nonce` |
| `refund_id` | 1 | 64 | `initiate_refund` |
| `payment_id` | 1 | 64 | `initiate_multisig_payment` |
| `plan_id` | 1 | 64 | `create_subscription_plan`, `subscribe` |
| `subscription_id` | 1 | 64 | `subscribe` |
| `request_id` | 1 | 64 | `create_payment_request` |
| `note` | 0 | 512 | `add_payment_note` |
| `evidence` | 0 | 512 | `dispute_refund` |
| `tag` (individual) | 1 | 32 | All functions accepting `tags: Option<Vec<String>>` (max 5 tags) |

## Validation Rules

### Merchant Registration

```rust
pub fn register_merchant(
    env: Env,
    merchant_address: Address,
    name: String,              // 1-64 characters
    description: String,       // 1-256 characters
    contact_info: String,      // 1-128 characters
    category: MerchantCategory,
) -> Result<(), PaymentError>
```

- **name**: Must be between 1 and 64 UTF-8 characters.
- **description**: Must be between 1 and 256 UTF-8 characters.
- **contact_info**: Must be between 1 and 128 UTF-8 characters (e.g., email, URL, Telegram handle).

### Payment Processing

```rust
pub fn process_payment_with_signature(
    env: Env,
    payer: Address,
    order_id: String,          // 1-64 characters
    merchant_address: Address,
    token_address: Address,
    amount: i128,
    memo: String,              // 0-128 characters
    tags: Option<Vec<String>>, // max 5 tags, each 1-32 characters
    signature: Bytes,
    merchant_public_key: Bytes,
) -> Result<(), PaymentError>
```

- **order_id**: Must be between 1 and 64 characters. Must be unique across all payments.
- **memo**: May be empty (0 characters) or up to 128 characters. Use for invoice numbers, descriptions, etc.
- **tags**: Optional. Maximum 5 tags, each between 1 and 32 characters.

### Refunds

```rust
pub fn initiate_refund(
    env: Env,
    caller: Address,
    refund_id: String,         // 1-64 characters
    order_id: String,
    amount: i128,
    reason: String,            // 1-256 characters
) -> Result<(), PaymentError>
```

- **refund_id**: Must be between 1 and 64 characters. Must be unique across all refunds.
- **reason**: Must be between 1 and 256 characters. Describes why the refund is requested.

### Multi-Signature Payments

```rust
pub fn initiate_multisig_payment(
    env: Env,
    initiator: Address,
    payment_id: String,        // 1-64 characters
    merchant_address: Address,
    token_address: Address,
    amount: i128,
    signers: Vec<Address>,
    required_signatures: u32,
) -> Result<(), PaymentError>
```

- **payment_id**: Must be between 1 and 64 characters. Must be unique across all multisig payments.

### Subscriptions

```rust
pub fn create_subscription_plan(
    env: Env,
    merchant: Address,
    plan_id: String,           // 1-64 characters
    token: Address,
    amount: i128,
    interval_secs: u64,
    max_cycles: u32,
) -> Result<(), PaymentError>
```

- **plan_id**: Must be between 1 and 64 characters. Must be unique across all subscription plans.
- **subscription_id**: Must be between 1 and 64 characters. Must be unique across all subscriptions.

### Payment Requests

```rust
pub fn create_payment_request(
    env: Env,
    merchant: Address,
    request_id: String,        // 1-64 characters
    token: Address,
    amount: i128,
    memo: String,              // 0-128 characters
    ttl: u64,
) -> Result<(), PaymentError>
```

- **request_id**: Must be between 1 and 64 characters. Must be unique across all payment requests.
- **memo**: May be empty or up to 128 characters.

### Notes and Evidence

```rust
pub fn add_payment_note(
    env: Env,
    merchant: Address,
    order_id: String,
    note: String,              // 0-512 characters
) -> Result<(), PaymentError>
```

- **note**: May be empty or up to 512 characters. Merchant-only field for internal records.

```rust
pub fn dispute_refund(
    env: Env,
    payer: Address,
    refund_id: String,
    evidence: String,          // 0-512 characters
) -> Result<(), PaymentError>
```

- **evidence**: May be empty or up to 512 characters. Payer provides supporting documentation or URLs.

## Error Handling

When a string parameter violates its length constraint, the contract returns:

```
PaymentError::InvalidInput (code 50)
```

Client applications should validate string lengths before submitting transactions to minimize failed transactions and wasted fees.

## Testing

All string length constraints are tested in the contract's test suite:

- Boundary tests confirm strings at maximum length succeed.
- Boundary tests confirm strings at maximum length + 1 fail with `InvalidInput`.
- See `contracts/lumenflow/src/test.rs` for full test coverage.

## Constants (Rust)

The following constants are defined in `contracts/lumenflow/src/helper.rs`:

```rust
pub const MAX_NAME_LEN: u32 = 64;
pub const MAX_DESCRIPTION_LEN: u32 = 256;
pub const MAX_MEMO_LEN: u32 = 128;
pub const MAX_REASON_LEN: u32 = 256;
pub const MAX_CONTACT_INFO_LEN: u32 = 128;
```

Use these constants when validating strings in off-chain code to match contract behavior exactly.

## Summary

By enforcing strict length limits on all string parameters, LumenFlow prevents storage bloat, mitigates denial-of-service vectors, and ensures predictable gas costs for all contract operations.
