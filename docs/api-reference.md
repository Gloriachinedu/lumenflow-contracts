# LumenFlow Contract API Reference

This document is the authoritative reference for every public function exposed by the `PaymentProcessingContract` on Soroban.

Each entry includes the function signature, a description, a parameter table, return type, and error codes. Error codes link to the full error catalogue in [docs/errors.md](errors.md).

> **Note:** This reference is derived from the inline Rustdoc comments in `contracts/lumenflow/src/lib.rs`. To regenerate HTML docs locally run:
> ```bash
> cargo doc --package lumenflow --open
> ```

---

## Table of Contents

1. [Versioning](#versioning)
2. [Admin](#admin)
3. [Merchant Management](#merchant-management)
4. [Payment Processing](#payment-processing)
5. [Payment History Queries](#payment-history-queries)
6. [Refunds](#refunds)
7. [Multi-Signature Payments](#multi-signature-payments)
8. [Subscriptions](#subscriptions)
9. [Payment Requests](#payment-requests)
10. [Data Types](#data-types)

---

## Versioning

### `get_contract_version`

```rust
pub fn get_contract_version(env: Env) -> String
```

Returns the deployed contract version string (matches `CARGO_PKG_VERSION`).

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| *(none)*  | —    | —        | —           |

**Returns:** `String` — semver version, e.g. `"1.0.0"`.

**Errors:** None.

---

## Admin

### `set_admin`

```rust
pub fn set_admin(env: Env, admin: Address) -> Result<(), PaymentError>
```

One-time admin initialisation. Can only be called once; subsequent calls fail with [`AdminAlreadySet`](errors.md#auth-errors).

| Parameter | Type      | Required | Constraints                   | Example |
|-----------|-----------|----------|-------------------------------|---------|
| `admin`   | `Address` | Yes      | Must not be a contract address | `GABC…` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 2 | [`AdminAlreadySet`](errors.md#auth-errors) | An admin has already been configured. |
| 3 | [`InvalidAdminAddress`](errors.md#auth-errors) | `admin` is a contract address. |

---

### `transfer_admin`

```rust
pub fn transfer_admin(env: Env, current_admin: Address, new_admin: Address) -> Result<(), PaymentError>
```

Transfer admin rights to a new address. The current admin must sign the call.

| Parameter       | Type      | Required | Example |
|-----------------|-----------|----------|---------|
| `current_admin` | `Address` | Yes      | `GABC…` |
| `new_admin`     | `Address` | Yes      | `GXYZ…` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `current_admin` is not the configured administrator. |

---

### `set_payment_cleanup_period`

```rust
pub fn set_payment_cleanup_period(env: Env, admin: Address, period: u64) -> Result<(), PaymentError>
```

Set the minimum age in seconds a payment must reach before it is eligible for removal by [`cleanup_expired_payments`](#cleanup_expired_payments).

| Parameter | Type      | Required | Constraints | Example |
|-----------|-----------|----------|-------------|---------|
| `admin`   | `Address` | Yes      | Must be the administrator | `GABC…` |
| `period`  | `u64`     | Yes      | Seconds; e.g. `7776000` = 90 days | `7776000` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |

---

### `set_platform_fee`

```rust
pub fn set_platform_fee(env: Env, admin: Address, fee_bps: u32, fee_recipient: Address) -> Result<(), PaymentError>
```

Set the platform fee in basis points and the fee recipient address. The fee is deducted from each payment processed via [`process_payment_with_signature`](#process_payment_with_signature).

| Parameter       | Type      | Required | Constraints | Example |
|-----------------|-----------|----------|-------------|---------|
| `admin`         | `Address` | Yes      | Must be the administrator | `GABC…` |
| `fee_bps`       | `u32`     | Yes      | Basis points; `100` = 1% | `50` |
| `fee_recipient` | `Address` | Yes      | Valid Stellar address | `GFEE…` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |

---

### `set_large_payment_threshold`

```rust
pub fn set_large_payment_threshold(env: Env, admin: Address, threshold: i128) -> Result<(), PaymentError>
```

Set the threshold for unusually large payments. Payments at or above this amount emit a `lumenflow/suspicious_activity` event.

| Parameter   | Type      | Required | Constraints | Example |
|-------------|-----------|----------|-------------|---------|
| `admin`     | `Address` | Yes      | Must be the administrator | `GABC…` |
| `threshold` | `i128`    | Yes      | Must be positive | `1000000000` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |
| 22 | [`InvalidAmount`](errors.md#payment-errors) | `threshold` is not positive. |

---

### `add_allowed_token`

```rust
pub fn add_allowed_token(env: Env, admin: Address, token: Address) -> Result<(), PaymentError>
```

Add a token contract address to the payment allow-list. Admin only.

| Parameter | Type      | Required | Example |
|-----------|-----------|----------|---------|
| `admin`   | `Address` | Yes      | `GABC…` |
| `token`   | `Address` | Yes      | `CTOKEN…` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |

---

### `remove_allowed_token`

```rust
pub fn remove_allowed_token(env: Env, admin: Address, token: Address) -> Result<(), PaymentError>
```

Remove a token contract address from the payment allow-list. Admin only.

| Parameter | Type      | Required | Example |
|-----------|-----------|----------|---------|
| `admin`   | `Address` | Yes      | `GABC…` |
| `token`   | `Address` | Yes      | `CTOKEN…` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |

---

### `set_multisig_expiry_duration`

```rust
pub fn set_multisig_expiry_duration(env: Env, admin: Address, duration: u64) -> Result<(), PaymentError>
```

Set the default expiry duration (seconds) for new multisig payments. Admin only.

| Parameter  | Type      | Required | Constraints | Example |
|------------|-----------|----------|-------------|---------|
| `admin`    | `Address` | Yes      | Must be the administrator | `GABC…` |
| `duration` | `u64`     | Yes      | Must be > 0 | `86400` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |
| 50 | [`InvalidInput`](errors.md#general-errors) | `duration` is 0. |

---

### `set_refund_window`

```rust
pub fn set_refund_window(env: Env, admin: Address, window_secs: u64) -> Result<(), PaymentError>
```

Override the refund window (default: 30 days = `2592000` seconds). Admin only.

| Parameter    | Type      | Required | Example |
|--------------|-----------|----------|---------|
| `admin`      | `Address` | Yes      | `GABC…` |
| `window_secs`| `u64`     | Yes      | `2592000` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |

---

### `set_min_refund_amount`

```rust
pub fn set_min_refund_amount(env: Env, admin: Address, amount: i128) -> Result<(), PaymentError>
```

Override the minimum refund amount (default: 100 stroops). Admin only.

| Parameter | Type      | Required | Constraints | Example |
|-----------|-----------|----------|-------------|---------|
| `admin`   | `Address` | Yes      | Must be the administrator | `GABC…` |
| `amount`  | `i128`    | Yes      | Must be positive | `100` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |
| 22 | [`InvalidAmount`](errors.md#payment-errors) | `amount` is not positive. |

---

### `pause_contract`

```rust
pub fn pause_contract(env: Env, admin: Address) -> Result<(), PaymentError>
```

Pause the contract. All state-mutating functions return [`ContractPaused`](errors.md#general-errors) while paused. Admin only.

| Parameter | Type      | Required | Example |
|-----------|-----------|----------|---------|
| `admin`   | `Address` | Yes      | `GABC…` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |

---

### `unpause_contract`

```rust
pub fn unpause_contract(env: Env, admin: Address) -> Result<(), PaymentError>
```

Unpause the contract. Admin only.

| Parameter | Type      | Required | Example |
|-----------|-----------|----------|---------|
| `admin`   | `Address` | Yes      | `GABC…` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |


---

## Merchant Management

### `register_merchant`

```rust
pub fn register_merchant(
    env: Env,
    merchant_address: Address,
    name: String,
    description: String,
    contact_info: String,
    category: MerchantCategory,
) -> Result<(), PaymentError>
```

Register a new merchant profile. The `merchant_address` must sign the call.

| Parameter          | Type               | Required | Constraints | Example |
|--------------------|--------------------|----------|-------------|---------|
| `merchant_address` | `Address`          | Yes      | Must not already be registered; must sign | `GMERCHANT…` |
| `name`             | `String`           | Yes      | Non-empty | `"My Shop"` |
| `description`      | `String`           | No       | Free text | `"Best shop in town"` |
| `contact_info`     | `String`           | No       | Email, URL, etc. | `"shop@example.com"` |
| `category`         | `MerchantCategory` | Yes      | One of `Retail`, `Food`, `Services`, `Digital`, `Other`, or `Custom(String)` (max 32 chars) | `Retail` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 11 | [`MerchantAlreadyRegistered`](errors.md#merchant-errors) | Address is already registered. |
| 50 | [`InvalidInput`](errors.md#general-errors) | `name` is empty or `category` string exceeds 32 chars. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |

---

### `update_merchant`

```rust
pub fn update_merchant(
    env: Env,
    merchant_address: Address,
    name: String,
    description: String,
    contact_info: String,
    category: MerchantCategory,
) -> Result<(), PaymentError>
```

Update an existing merchant profile. The `merchant_address` must sign the call.

| Parameter          | Type               | Required | Constraints | Example |
|--------------------|--------------------|----------|-------------|---------|
| `merchant_address` | `Address`          | Yes      | Must be registered and active; must sign | `GMERCHANT…` |
| `name`             | `String`           | Yes      | Non-empty | `"My Updated Shop"` |
| `description`      | `String`           | No       | Free text | `"New description"` |
| `contact_info`     | `String`           | No       | Email, URL, etc. | `"new@example.com"` |
| `category`         | `MerchantCategory` | Yes      | See `register_merchant` | `Digital` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 10 | [`MerchantNotFound`](errors.md#merchant-errors) | No profile exists for the address. |
| 12 | [`MerchantInactive`](errors.md#merchant-errors) | Merchant is deactivated. |
| 50 | [`InvalidInput`](errors.md#general-errors) | `name` is empty. |

---

### `deactivate_merchant`

```rust
pub fn deactivate_merchant(env: Env, admin: Address, merchant_address: Address) -> Result<(), PaymentError>
```

Deactivate a merchant. Deactivated merchants cannot receive new payments. Admin only.

| Parameter          | Type      | Required | Example |
|--------------------|-----------|----------|---------|
| `admin`            | `Address` | Yes      | `GABC…` |
| `merchant_address` | `Address` | Yes      | `GMERCHANT…` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |
| 10 | [`MerchantNotFound`](errors.md#merchant-errors) | No profile exists for `merchant_address`. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |

---

### `reactivate_merchant`

```rust
pub fn reactivate_merchant(env: Env, admin: Address, merchant_address: Address) -> Result<(), PaymentError>
```

Reactivate a previously deactivated merchant. Admin only.

| Parameter          | Type      | Required | Example |
|--------------------|-----------|----------|---------|
| `admin`            | `Address` | Yes      | `GABC…` |
| `merchant_address` | `Address` | Yes      | `GMERCHANT…` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |
| 10 | [`MerchantNotFound`](errors.md#merchant-errors) | No profile exists for `merchant_address`. |
| 50 | [`InvalidInput`](errors.md#general-errors) | Merchant is already active. |

---

### `verify_merchant`

```rust
pub fn verify_merchant(env: Env, admin: Address, merchant_address: Address) -> Result<(), PaymentError>
```

Set the `verified` flag on a merchant profile. Admin only.

| Parameter          | Type      | Required | Example |
|--------------------|-----------|----------|---------|
| `admin`            | `Address` | Yes      | `GABC…` |
| `merchant_address` | `Address` | Yes      | `GMERCHANT…` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |
| 10 | [`MerchantNotFound`](errors.md#merchant-errors) | No profile exists for `merchant_address`. |

---

### `unverify_merchant`

```rust
pub fn unverify_merchant(env: Env, admin: Address, merchant_address: Address) -> Result<(), PaymentError>
```

Clear the `verified` flag on a merchant profile. Admin only.

| Parameter          | Type      | Required | Example |
|--------------------|-----------|----------|---------|
| `admin`            | `Address` | Yes      | `GABC…` |
| `merchant_address` | `Address` | Yes      | `GMERCHANT…` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |
| 10 | [`MerchantNotFound`](errors.md#merchant-errors) | No profile exists for `merchant_address`. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |

---

### `get_merchant`

```rust
pub fn get_merchant(env: Env, merchant_address: Address) -> Result<Merchant, PaymentError>
```

Retrieve a merchant profile. No auth required.

| Parameter          | Type      | Required | Example |
|--------------------|-----------|----------|---------|
| `merchant_address` | `Address` | Yes      | `GMERCHANT…` |

**Returns:** [`Merchant`](#merchant) struct on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 10 | [`MerchantNotFound`](errors.md#merchant-errors) | No profile exists for `merchant_address`. |

---

### `is_registered`

```rust
pub fn is_registered(env: Env, merchant_address: Address) -> bool
```

Check whether an address has a registered merchant profile. No auth required.

| Parameter          | Type      | Required | Example |
|--------------------|-----------|----------|---------|
| `merchant_address` | `Address` | Yes      | `GMERCHANT…` |

**Returns:** `true` if registered, `false` otherwise.

**Errors:** None.


---

## Payment Processing

### `process_payment_with_signature`

```rust
pub fn process_payment_with_signature(
    env: Env,
    payer: Address,
    order_id: String,
    merchant_address: Address,
    token_address: Address,
    amount: i128,
    memo: String,
    tags: Option<Vec<String>>,
    signature: Bytes,
    merchant_public_key: Bytes,
) -> Result<(), PaymentError>
```

Transfer tokens from `payer` to `merchant_address` after verifying the merchant's ed25519 signature over the canonical payload. See [docs/signature-format.md](signature-format.md) for the exact payload construction.

| Parameter             | Type                  | Required | Constraints | Example |
|-----------------------|-----------------------|----------|-------------|---------|
| `payer`               | `Address`             | Yes      | Must sign the call | `GPAYER…` |
| `order_id`            | `String`              | Yes      | Non-empty; must be globally unique | `"ORDER-001"` |
| `merchant_address`    | `Address`             | Yes      | Must be registered and active | `GMERCHANT…` |
| `token_address`       | `Address`             | Yes      | Must be on the allow-list | `CTOKEN…` |
| `amount`              | `i128`                | Yes      | Positive (smallest token unit, e.g. stroops) | `1000000000` |
| `memo`                | `String`              | No       | Max 256 characters | `"Invoice #001"` |
| `tags`                | `Option<Vec<String>>` | No       | Max 10 tags; each tag max 32 chars | `["coffee"]` |
| `signature`           | `Bytes`               | Yes      | 64-byte ed25519 signature from merchant's key | `<bytes>` |
| `merchant_public_key` | `Bytes`               | Yes      | 32-byte ed25519 public key matching `signature` | `<bytes>` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 22 | [`InvalidAmount`](errors.md#payment-errors) | `amount` is not positive. |
| 50 | [`InvalidInput`](errors.md#general-errors) | `order_id` empty, `memo` > 256 chars, or invalid tags. |
| 26 | [`TokenNotAllowed`](errors.md#payment-errors) | `token_address` not on the allow-list. |
| 21 | [`PaymentAlreadyExists`](errors.md#payment-errors) | A payment with `order_id` already exists. |
| 10 | [`MerchantNotFound`](errors.md#merchant-errors) | No merchant at `merchant_address`. |
| 12 | [`MerchantInactive`](errors.md#merchant-errors) | Merchant is deactivated. |
| 23 | [`InvalidSignature`](errors.md#payment-errors) | Signature verification failed. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |

---

### `process_payment_with_nonce`

```rust
pub fn process_payment_with_nonce(
    env: Env,
    payer: Address,
    order_id: String,
    merchant_address: Address,
    token_address: Address,
    amount: i128,
    memo: String,
    tags: Option<Vec<String>>,
    nonce: u64,
) -> Result<(), PaymentError>
```

Transfer tokens with replay prevention via a nonce instead of a merchant signature. Suitable for trusted integrations where off-chain signing is not required.

| Parameter          | Type                  | Required | Constraints | Example |
|--------------------|-----------------------|----------|-------------|---------|
| `payer`            | `Address`             | Yes      | Must sign the call | `GPAYER…` |
| `order_id`         | `String`              | Yes      | Non-empty; must be globally unique | `"ORDER-002"` |
| `merchant_address` | `Address`             | Yes      | Must be registered and active | `GMERCHANT…` |
| `token_address`    | `Address`             | Yes      | Must be on the allow-list | `CTOKEN…` |
| `amount`           | `i128`                | Yes      | Positive | `500000000` |
| `memo`             | `String`              | No       | Max 256 characters | `"Subscription"` |
| `tags`             | `Option<Vec<String>>` | No       | Max 10 tags; each max 32 chars | `null` |
| `nonce`            | `u64`                 | Yes      | Must equal current nonce; increments on success | `0` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 4 | [`InvalidNonce`](errors.md#auth-errors) | `nonce` does not match the expected value. |
| 22 | [`InvalidAmount`](errors.md#payment-errors) | `amount` is not positive. |
| 50 | [`InvalidInput`](errors.md#general-errors) | `order_id` empty or invalid tags. |
| 26 | [`TokenNotAllowed`](errors.md#payment-errors) | `token_address` not on the allow-list. |
| 21 | [`PaymentAlreadyExists`](errors.md#payment-errors) | A payment with `order_id` already exists. |
| 10 | [`MerchantNotFound`](errors.md#merchant-errors) | No merchant at `merchant_address`. |
| 12 | [`MerchantInactive`](errors.md#merchant-errors) | Merchant is deactivated. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |

---

### `batch_payment`

```rust
pub fn batch_payment(env: Env, payer: Address, payments: Vec<BatchPaymentItem>) -> Result<(), PaymentError>
```

Pay up to 10 merchants in a single atomic transaction. All items are validated and transferred together — if any item fails the entire batch is rolled back.

| Parameter  | Type                    | Required | Constraints | Example |
|------------|-------------------------|----------|-------------|---------|
| `payer`    | `Address`               | Yes      | Must sign the call | `GPAYER…` |
| `payments` | `Vec<BatchPaymentItem>` | Yes      | 1–10 items; see [`BatchPaymentItem`](#batchpaymentitem) | `[…]` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 52 | [`BatchSizeExceeded`](errors.md#general-errors) | More than 10 items provided. |
| 22 | [`InvalidAmount`](errors.md#payment-errors) | Any item has a non-positive amount. |
| 50 | [`InvalidInput`](errors.md#general-errors) | Any item has an empty `order_id`. |
| 26 | [`TokenNotAllowed`](errors.md#payment-errors) | Any item's token is not on the allow-list. |
| 21 | [`PaymentAlreadyExists`](errors.md#payment-errors) | Any item's `order_id` already exists. |
| 10 | [`MerchantNotFound`](errors.md#merchant-errors) | Any item's merchant is not registered. |
| 12 | [`MerchantInactive`](errors.md#merchant-errors) | Any item's merchant is deactivated. |
| 23 | [`InvalidSignature`](errors.md#payment-errors) | Any item's signature verification fails. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |

---

### `get_payment_by_id`

```rust
pub fn get_payment_by_id(env: Env, caller: Address, order_id: String) -> Result<PaymentOrder, PaymentError>
```

Retrieve full payment details. Caller must be the payer, merchant, or admin.

| Parameter  | Type      | Required | Constraints | Example |
|------------|-----------|----------|-------------|---------|
| `caller`   | `Address` | Yes      | Must be payer, merchant, or admin; must sign | `GCALLER…` |
| `order_id` | `String`  | Yes      | Non-empty | `"ORDER-001"` |

**Returns:** [`PaymentOrder`](#paymentorder) on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 20 | [`PaymentNotFound`](errors.md#payment-errors) | No payment with `order_id`. |
| 1 | [`Unauthorized`](errors.md#auth-errors) | Caller is not payer, merchant, or admin. |

---

### `get_payment_summary`

```rust
pub fn get_payment_summary(env: Env, order_id: String) -> Result<PaymentSummary, PaymentError>
```

Retrieve a public summary of a payment. No auth required.

| Parameter  | Type     | Required | Example |
|------------|----------|----------|---------|
| `order_id` | `String` | Yes      | `"ORDER-001"` |

**Returns:** [`PaymentSummary`](#paymentsummary) on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 20 | [`PaymentNotFound`](errors.md#payment-errors) | No payment with `order_id`. |

---

### `update_payment_status`

```rust
pub fn update_payment_status(env: Env, caller: Address, order_id: String, refunded_amount: i128) -> Result<(), PaymentError>
```

Update a payment's refunded amount and status after a partial or full refund. Caller must be the admin or the payment's merchant.

| Parameter         | Type      | Required | Constraints | Example |
|-------------------|-----------|----------|-------------|---------|
| `caller`          | `Address` | Yes      | Must be admin or merchant; must sign | `GMERCHANT…` |
| `order_id`        | `String`  | Yes      | Non-empty | `"ORDER-001"` |
| `refunded_amount` | `i128`    | Yes      | Cumulative refunded amount so far | `500000000` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 20 | [`PaymentNotFound`](errors.md#payment-errors) | No payment with `order_id`. |
| 1 | [`Unauthorized`](errors.md#auth-errors) | Caller is not admin or merchant. |

---

### `archive_payment_record`

```rust
pub fn archive_payment_record(env: Env, admin: Address, order_id: String) -> Result<(), PaymentError>
```

Remove a payment record from storage. Admin only. Emits `lumenflow/payment_archived`.

| Parameter  | Type      | Required | Example |
|------------|-----------|----------|---------|
| `admin`    | `Address` | Yes      | `GABC…` |
| `order_id` | `String`  | Yes      | `"ORDER-001"` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |
| 20 | [`PaymentNotFound`](errors.md#payment-errors) | No payment with `order_id`. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |

---

### `cleanup_expired_payments`

```rust
pub fn cleanup_expired_payments(env: Env, admin: Address) -> Result<u32, PaymentError>
```

Remove all payment records older than the configured cleanup period. Admin only.

| Parameter | Type      | Required | Example |
|-----------|-----------|----------|---------|
| `admin`   | `Address` | Yes      | `GABC…` |

**Returns:** `u32` — number of records removed.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |


---

## Payment History Queries

### `get_merchant_payment_history`

```rust
pub fn get_merchant_payment_history(
    env: Env,
    merchant: Address,
    cursor: Option<String>,
    limit: u32,
    filter: Option<PaymentFilter>,
    sort_field: SortField,
    sort_order: SortOrder,
) -> Result<PaymentPage, PaymentError>
```

Paginated payment history for a merchant. The merchant must sign the call.

| Parameter    | Type                   | Required | Constraints | Example |
|--------------|------------------------|----------|-------------|---------|
| `merchant`   | `Address`              | Yes      | Must sign the call | `GMERCHANT…` |
| `cursor`     | `Option<String>`       | No       | `order_id` to start after (exclusive); `null` = first page | `null` |
| `limit`      | `u32`                  | Yes      | 1–100 inclusive | `10` |
| `filter`     | `Option<PaymentFilter>`| No       | See [`PaymentFilter`](#paymentfilter) | `null` |
| `sort_field` | `SortField`            | Yes      | `Date` or `Amount` | `Date` |
| `sort_order` | `SortOrder`            | Yes      | `Ascending` or `Descending` | `Descending` |

**Returns:** [`PaymentPage`](#paymentpage) on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 50 | [`InvalidInput`](errors.md#general-errors) | `limit` is 0 or exceeds 100. |

---

### `get_payer_payment_history`

```rust
pub fn get_payer_payment_history(
    env: Env,
    payer: Address,
    cursor: Option<String>,
    limit: u32,
    filter: Option<PaymentFilter>,
    sort_field: SortField,
    sort_order: SortOrder,
) -> Result<PaymentPage, PaymentError>
```

Paginated payment history for a payer. The payer must sign the call. Parameters are identical to [`get_merchant_payment_history`](#get_merchant_payment_history).

| Parameter    | Type                   | Required | Constraints | Example |
|--------------|------------------------|----------|-------------|---------|
| `payer`      | `Address`              | Yes      | Must sign the call | `GPAYER…` |
| `cursor`     | `Option<String>`       | No       | `order_id` to start after; `null` = first page | `null` |
| `limit`      | `u32`                  | Yes      | 1–100 | `20` |
| `filter`     | `Option<PaymentFilter>`| No       | See [`PaymentFilter`](#paymentfilter) | `null` |
| `sort_field` | `SortField`            | Yes      | `Date` or `Amount` | `Amount` |
| `sort_order` | `SortOrder`            | Yes      | `Ascending` or `Descending` | `Ascending` |

**Returns:** [`PaymentPage`](#paymentpage) on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 50 | [`InvalidInput`](errors.md#general-errors) | `limit` is 0 or exceeds 100. |

---

### `get_global_payment_stats`

```rust
pub fn get_global_payment_stats(
    env: Env,
    admin: Address,
    date_start: Option<u64>,
    date_end: Option<u64>,
) -> Result<GlobalStats, PaymentError>
```

Global payment statistics. Admin only. When neither `date_start` nor `date_end` is provided the cached all-time aggregate is returned instantly. When a date range is provided the contract iterates all payments to compute filtered stats.

| Parameter    | Type          | Required | Constraints | Example |
|--------------|---------------|----------|-------------|---------|
| `admin`      | `Address`     | Yes      | Must be the administrator | `GABC…` |
| `date_start` | `Option<u64>` | No       | Unix timestamp (seconds); must be ≤ `date_end` if both provided | `1700000000` |
| `date_end`   | `Option<u64>` | No       | Unix timestamp (seconds) | `1710000000` |

**Returns:** [`GlobalStats`](#globalstats) on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | `admin` is not the configured administrator. |
| 50 | [`InvalidInput`](errors.md#general-errors) | `date_start` > `date_end`. |

---

### `get_merchant_stats`

```rust
pub fn get_merchant_stats(env: Env, merchant: Address) -> Result<MerchantStats, PaymentError>
```

Per-merchant payment statistics. The merchant must sign the call.

| Parameter  | Type      | Required | Example |
|------------|-----------|----------|---------|
| `merchant` | `Address` | Yes      | `GMERCHANT…` |

**Returns:** `MerchantStats` (`total_payments`, `total_volume`, `total_refunds`, `total_refund_volume`).

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 1 | [`Unauthorized`](errors.md#auth-errors) | Caller is not the merchant. |

---

## Refunds

Refund rules:
- **Window:** 30 days from `paid_at` (configurable via [`set_refund_window`](#set_refund_window)).
- **Minimum amount:** 100 stroops by default (configurable via [`set_min_refund_amount`](#set_min_refund_amount)).
- **Partial refunds:** allowed; cumulative total cannot exceed original payment amount.
- **Initiator:** payer or merchant.
- **Approver / Rejector:** merchant or admin.
- **Executor:** merchant (signs the token transfer).

### `initiate_refund`

```rust
pub fn initiate_refund(
    env: Env,
    caller: Address,
    refund_id: String,
    order_id: String,
    amount: i128,
    reason: String,
) -> Result<(), PaymentError>
```

Open a refund request in `Pending` state.

| Parameter   | Type      | Required | Constraints | Example |
|-------------|-----------|----------|-------------|---------|
| `caller`    | `Address` | Yes      | Must be the payer or merchant; must sign | `GPAYER…` |
| `refund_id` | `String`  | Yes      | Non-empty; globally unique | `"REFUND-001"` |
| `order_id`  | `String`  | Yes      | Must reference an existing payment | `"ORDER-001"` |
| `amount`    | `i128`    | Yes      | Positive; ≥ min refund amount; cumulative total ≤ original amount | `500000000` |
| `reason`    | `String`  | Yes      | Max 256 characters | `"Customer request"` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 22 | [`InvalidAmount`](errors.md#payment-errors) | `amount` is not positive. |
| 50 | [`InvalidInput`](errors.md#general-errors) | `refund_id` empty or `reason` > 256 chars. |
| 31 | [`RefundAlreadyExists`](errors.md#refund-errors) | A refund with `refund_id` already exists. |
| 20 | [`PaymentNotFound`](errors.md#payment-errors) | No payment with `order_id`. |
| 1 | [`Unauthorized`](errors.md#auth-errors) | Caller is not the payer or merchant. |
| 32 | [`RefundWindowExpired`](errors.md#refund-errors) | More than the refund window has elapsed since payment. |
| 33 | [`RefundExceedsOriginal`](errors.md#refund-errors) | Cumulative refund would exceed original amount. |
| 36 | [`TooManyRefunds`](errors.md#refund-errors) | Per-order refund limit reached. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |

---

### `approve_refund`

```rust
pub fn approve_refund(env: Env, caller: Address, refund_id: String) -> Result<(), PaymentError>
```

Approve a pending refund. Transitions status from `Pending` → `Approved`. Merchant or admin only.

| Parameter   | Type      | Required | Example |
|-------------|-----------|----------|---------|
| `caller`    | `Address` | Yes      | `GMERCHANT…` |
| `refund_id` | `String`  | Yes      | `"REFUND-001"` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 30 | [`RefundNotFound`](errors.md#refund-errors) | No refund with `refund_id`. |
| 20 | [`PaymentNotFound`](errors.md#payment-errors) | Associated payment no longer exists. |
| 1 | [`Unauthorized`](errors.md#auth-errors) | Caller is not the merchant or admin. |
| 35 | [`RefundAlreadyCompleted`](errors.md#refund-errors) | Refund is not in `Pending` state. |

---

### `reject_refund`

```rust
pub fn reject_refund(env: Env, caller: Address, refund_id: String) -> Result<(), PaymentError>
```

Reject a pending refund. Transitions status from `Pending` → `Rejected`. Merchant or admin only.

| Parameter   | Type      | Required | Example |
|-------------|-----------|----------|---------|
| `caller`    | `Address` | Yes      | `GMERCHANT…` |
| `refund_id` | `String`  | Yes      | `"REFUND-001"` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 30 | [`RefundNotFound`](errors.md#refund-errors) | No refund with `refund_id`. |
| 20 | [`PaymentNotFound`](errors.md#payment-errors) | Associated payment no longer exists. |
| 1 | [`Unauthorized`](errors.md#auth-errors) | Caller is not the merchant or admin. |
| 35 | [`RefundAlreadyCompleted`](errors.md#refund-errors) | Refund is not in `Pending` state. |

---

### `execute_refund`

```rust
pub fn execute_refund(env: Env, refund_id: String) -> Result<(), PaymentError>
```

Execute an approved refund. Transfers tokens from the merchant to the payer. The merchant must authorise the token transfer. Follows checks-effects-interactions pattern.

| Parameter   | Type     | Required | Example |
|-------------|----------|----------|---------|
| `refund_id` | `String` | Yes      | `"REFUND-001"` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 30 | [`RefundNotFound`](errors.md#refund-errors) | No refund with `refund_id`. |
| 34 | [`RefundNotApproved`](errors.md#refund-errors) | Refund is not in `Approved` state. |
| 20 | [`PaymentNotFound`](errors.md#payment-errors) | Associated payment no longer exists. |

---

### `get_refund`

```rust
pub fn get_refund(env: Env, refund_id: String) -> Result<RefundRecord, PaymentError>
```

Retrieve a refund record. No auth required.

| Parameter   | Type     | Required | Example |
|-------------|----------|----------|---------|
| `refund_id` | `String` | Yes      | `"REFUND-001"` |

**Returns:** [`RefundRecord`](#refundrecord) on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 30 | [`RefundNotFound`](errors.md#refund-errors) | No refund with `refund_id`. |

---

### `get_refunds_for_order`

```rust
pub fn get_refunds_for_order(env: Env, caller: Address, order_id: String) -> Result<Vec<RefundRecord>, PaymentError>
```

List all refunds associated with an order. Caller must be payer, merchant, or admin.

| Parameter  | Type      | Required | Example |
|------------|-----------|----------|---------|
| `caller`   | `Address` | Yes      | Must be payer, merchant, or admin; must sign | `GCALLER…` |
| `order_id` | `String`  | Yes      | `"ORDER-001"` |

**Returns:** `Vec<RefundRecord>` (may be empty).

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 20 | [`PaymentNotFound`](errors.md#payment-errors) | No payment with `order_id`. |
| 1 | [`Unauthorized`](errors.md#auth-errors) | Caller is not payer, merchant, or admin. |


---

## Multi-Signature Payments

### `initiate_multisig_payment`

```rust
pub fn initiate_multisig_payment(
    env: Env,
    initiator: Address,
    payment_id: String,
    merchant_address: Address,
    token_address: Address,
    amount: i128,
    signers: Vec<Address>,
    required_signatures: u32,
    expires_at: Option<u64>,
) -> Result<(), PaymentError>
```

Create a multisig payment requiring `required_signatures` approvals before funds are transferred.

| Parameter             | Type              | Required | Constraints | Example |
|-----------------------|-------------------|----------|-------------|---------|
| `initiator`           | `Address`         | Yes      | Must sign the call | `GINITIATOR…` |
| `payment_id`          | `String`          | Yes      | Non-empty; globally unique | `"MS-001"` |
| `merchant_address`    | `Address`         | Yes      | Must be registered and active | `GMERCHANT…` |
| `token_address`       | `Address`         | Yes      | Must be on the allow-list | `CTOKEN…` |
| `amount`              | `i128`            | Yes      | Positive | `5000000000` |
| `signers`             | `Vec<Address>`    | Yes      | Non-empty; no duplicates; length ≥ `required_signatures` | `["GSIG1…","GSIG2…"]` |
| `required_signatures` | `u32`             | Yes      | > 0; ≤ `signers.len()` | `2` |
| `expires_at`          | `Option<u64>`     | No       | Unix timestamp; defaults to `now + multisig_expiry_duration` | `null` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 22 | [`InvalidAmount`](errors.md#payment-errors) | `amount` is not positive. |
| 50 | [`InvalidInput`](errors.md#general-errors) | `payment_id` empty, `signers` empty, `required_signatures` 0, or `required_signatures` > `signers.len()`. |
| 26 | [`TokenNotAllowed`](errors.md#payment-errors) | `token_address` not on allow-list. |
| 21 | [`PaymentAlreadyExists`](errors.md#payment-errors) | A multisig payment with `payment_id` already exists. |
| 10 | [`MerchantNotFound`](errors.md#merchant-errors) | No merchant at `merchant_address`. |
| 12 | [`MerchantInactive`](errors.md#merchant-errors) | Merchant is deactivated. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |

---

### `sign_multisig_payment`

```rust
pub fn sign_multisig_payment(env: Env, signer: Address, payment_id: String, signature: Bytes) -> Result<(), PaymentError>
```

Add a signature to a multisig payment. Each listed signer may call this once.

| Parameter    | Type      | Required | Constraints | Example |
|--------------|-----------|----------|-------------|---------|
| `signer`     | `Address` | Yes      | Must be in the payment's `signers` list; must sign the call | `GSIG1…` |
| `payment_id` | `String`  | Yes      | Must reference a non-executed multisig payment | `"MS-001"` |
| `signature`  | `Bytes`   | Yes      | Signer's signature bytes | `<bytes>` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 40 | [`MultisigNotFound`](errors.md#multisig-errors) | No multisig payment with `payment_id`. |
| 42 | [`MultisigAlreadyExecuted`](errors.md#multisig-errors) | Payment has already been executed. |
| 1 | [`Unauthorized`](errors.md#auth-errors) | `signer` is not in the allowed signers list. |
| 41 | [`MultisigAlreadySigned`](errors.md#multisig-errors) | `signer` has already signed. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |

---

### `execute_multisig_payment`

```rust
pub fn execute_multisig_payment(env: Env, payer: Address, payment_id: String) -> Result<(), PaymentError>
```

Execute a multisig payment once enough signatures are collected. Transfers `amount` tokens from `payer` to the merchant.

| Parameter    | Type      | Required | Example |
|--------------|-----------|----------|---------|
| `payer`      | `Address` | Yes      | Must sign the call; funds the transfer | `GPAYER…` |
| `payment_id` | `String`  | Yes      | `"MS-001"` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 40 | [`MultisigNotFound`](errors.md#multisig-errors) | No multisig payment with `payment_id`. |
| 42 | [`MultisigAlreadyExecuted`](errors.md#multisig-errors) | Payment has already been executed. |
| 44 | [`MultisigAlreadyCancelled`](errors.md#multisig-errors) | Payment has been cancelled. |
| 24 | [`PaymentExpired`](errors.md#payment-errors) | Payment has passed its `expires_at` timestamp. |
| 43 | [`InsufficientSignatures`](errors.md#multisig-errors) | Fewer signatures than required. |
| 70 | [`ContractPaused`](errors.md#general-errors) | Contract is paused. |

---

### `cancel_multisig_payment`

```rust
pub fn cancel_multisig_payment(env: Env, caller: Address, payment_id: String) -> Result<(), PaymentError>
```

Cancel a multisig payment that has not yet been executed. Initiator or admin only.

| Parameter    | Type      | Required | Example |
|--------------|-----------|----------|---------|
| `caller`     | `Address` | Yes      | Must be the initiator or admin; must sign | `GINITIATOR…` |
| `payment_id` | `String`  | Yes      | `"MS-001"` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 40 | [`MultisigNotFound`](errors.md#multisig-errors) | No multisig payment with `payment_id`. |
| 42 | [`MultisigAlreadyExecuted`](errors.md#multisig-errors) | Payment has already been executed. |
| 44 | [`MultisigAlreadyCancelled`](errors.md#multisig-errors) | Payment is already cancelled. |
| 1 | [`Unauthorized`](errors.md#auth-errors) | Caller is not the initiator or admin. |

---

### `get_multisig_payment`

```rust
pub fn get_multisig_payment(env: Env, caller: Address, payment_id: String) -> Result<MultisigPayment, PaymentError>
```

Retrieve a multisig payment record. Caller must be the initiator, a listed signer, the merchant, or the admin.

| Parameter    | Type      | Required | Example |
|--------------|-----------|----------|---------|
| `caller`     | `Address` | Yes      | Must sign the call | `GCALLER…` |
| `payment_id` | `String`  | Yes      | `"MS-001"` |

**Returns:** [`MultisigPayment`](#multisigpayment) on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 40 | [`MultisigNotFound`](errors.md#multisig-errors) | No multisig payment with `payment_id`. |
| 1 | [`Unauthorized`](errors.md#auth-errors) | Caller is not initiator, signer, merchant, or admin. |

---

## Subscriptions

### `create_subscription_plan`

```rust
pub fn create_subscription_plan(
    env: Env,
    merchant: Address,
    plan_id: String,
    token: Address,
    amount: i128,
    interval_secs: u64,
    max_cycles: u32,
) -> Result<(), PaymentError>
```

Create a recurring billing plan. The merchant must sign the call.

| Parameter       | Type      | Required | Constraints | Example |
|-----------------|-----------|----------|-------------|---------|
| `merchant`      | `Address` | Yes      | Must be a registered, active merchant; must sign | `GMERCHANT…` |
| `plan_id`       | `String`  | Yes      | Non-empty; unique per merchant | `"PLAN-MONTHLY"` |
| `token`         | `Address` | Yes      | Must be on the allow-list | `CTOKEN…` |
| `amount`        | `i128`    | Yes      | Positive | `100000000` |
| `interval_secs` | `u64`     | Yes      | Seconds between charges; e.g. `2592000` = 30 days | `2592000` |
| `max_cycles`    | `u32`     | Yes      | Maximum charges; 0 = unlimited | `12` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 60 | [`SubscriptionPlanAlreadyExists`](errors.md#subscription-errors) | A plan with `plan_id` already exists. |
| 22 | [`InvalidAmount`](errors.md#payment-errors) | `amount` is not positive. |
| 26 | [`TokenNotAllowed`](errors.md#payment-errors) | `token` not on allow-list. |

---

### `subscribe`

```rust
pub fn subscribe(env: Env, subscriber: Address, subscription_id: String, plan_id: String) -> Result<(), PaymentError>
```

Subscribe to an existing plan. The subscriber must sign the call.

| Parameter         | Type      | Required | Example |
|-------------------|-----------|----------|---------|
| `subscriber`      | `Address` | Yes      | Must sign | `GSUB…` |
| `subscription_id` | `String`  | Yes      | Non-empty; unique | `"SUB-001"` |
| `plan_id`         | `String`  | Yes      | Must reference an existing plan | `"PLAN-MONTHLY"` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 61 | [`SubscriptionAlreadyExists`](errors.md#subscription-errors) | A subscription with `subscription_id` already exists. |
| 62 | [`SubscriptionPlanNotFound`](errors.md#subscription-errors) | No plan with `plan_id`. |

---

### `charge_subscription`

```rust
pub fn charge_subscription(env: Env, subscription_id: String) -> Result<(), PaymentError>
```

Charge a subscriber for the next billing cycle. Anyone may call this; the subscriber authorises the token transfer.

| Parameter         | Type     | Required | Example |
|-------------------|----------|----------|---------|
| `subscription_id` | `String` | Yes      | `"SUB-001"` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 63 | [`SubscriptionNotFound`](errors.md#subscription-errors) | No subscription with `subscription_id`. |
| 64 | [`SubscriptionNotActive`](errors.md#subscription-errors) | Subscription is cancelled or completed. |
| 65 | [`SubscriptionMaxCyclesReached`](errors.md#subscription-errors) | Maximum billing cycles reached. |
| 66 | [`SubscriptionIntervalNotElapsed`](errors.md#subscription-errors) | Billing interval has not yet elapsed. |

---

### `cancel_subscription`

```rust
pub fn cancel_subscription(env: Env, subscriber: Address, subscription_id: String) -> Result<(), PaymentError>
```

Cancel an active subscription. The subscriber must sign the call.

| Parameter         | Type      | Required | Example |
|-------------------|-----------|----------|---------|
| `subscriber`      | `Address` | Yes      | Must sign | `GSUB…` |
| `subscription_id` | `String`  | Yes      | `"SUB-001"` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 63 | [`SubscriptionNotFound`](errors.md#subscription-errors) | No subscription with `subscription_id`. |
| 64 | [`SubscriptionNotActive`](errors.md#subscription-errors) | Subscription is already cancelled or completed. |
| 1 | [`Unauthorized`](errors.md#auth-errors) | Caller is not the subscriber. |

---

## Payment Requests

### `create_payment_request`

```rust
pub fn create_payment_request(
    env: Env,
    merchant: Address,
    request_id: String,
    token: Address,
    amount: i128,
    memo: String,
    ttl: u64,
) -> Result<(), PaymentError>
```

Create a shareable payment request (e.g. a payment link). The merchant must sign the call.

| Parameter    | Type      | Required | Constraints | Example |
|--------------|-----------|----------|-------------|---------|
| `merchant`   | `Address` | Yes      | Must be registered and active; must sign | `GMERCHANT…` |
| `request_id` | `String`  | Yes      | Non-empty; unique | `"REQ-001"` |
| `token`      | `Address` | Yes      | Must be on the allow-list | `CTOKEN…` |
| `amount`     | `i128`    | Yes      | Positive | `200000000` |
| `memo`       | `String`  | No       | Max 256 characters | `"Consulting invoice"` |
| `ttl`        | `u64`     | Yes      | Seconds until expiry from `now` | `3600` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 22 | [`InvalidAmount`](errors.md#payment-errors) | `amount` is not positive. |
| 26 | [`TokenNotAllowed`](errors.md#payment-errors) | `token` not on allow-list. |
| 10 | [`MerchantNotFound`](errors.md#merchant-errors) | Merchant not registered. |
| 12 | [`MerchantInactive`](errors.md#merchant-errors) | Merchant is deactivated. |

---

### `pay_payment_request`

```rust
pub fn pay_payment_request(env: Env, payer: Address, request_id: String) -> Result<(), PaymentError>
```

Pay a payment request. The payer must sign the call. Emits `lumenflow/payment_request_paid`.

| Parameter    | Type      | Required | Example |
|--------------|-----------|----------|---------|
| `payer`      | `Address` | Yes      | Must sign | `GPAYER…` |
| `request_id` | `String`  | Yes      | `"REQ-001"` |

**Returns:** `()` on success.

**Errors:**

| Code | Name | Condition |
|------|------|-----------|
| 20 | [`PaymentNotFound`](errors.md#payment-errors) | No payment request with `request_id`. |
| 24 | [`PaymentExpired`](errors.md#payment-errors) | Payment request has passed its TTL. |
| 25 | [`InsufficientBalance`](errors.md#payment-errors) | Payer does not have sufficient token balance. |

---

## Data Types

### `Merchant`

| Field           | Type               | Description |
|-----------------|--------------------|-------------|
| `address`       | `Address`          | Stellar address of the merchant. |
| `name`          | `String`           | Display name. |
| `description`   | `String`           | Business description. |
| `contact_info`  | `String`           | Contact details. |
| `category`      | `MerchantCategory` | Business category. |
| `active`        | `bool`             | `false` if deactivated by admin. |
| `verified`      | `bool`             | `true` if verified by admin. |
| `registered_at` | `u64`              | Unix timestamp of registration. |
| `total_received`| `i128`             | Cumulative payment volume received. |

---

### `PaymentOrder`

| Field              | Type                  | Description |
|--------------------|-----------------------|-------------|
| `order_id`         | `String`              | Unique order identifier. |
| `merchant_address` | `Address`             | Receiving merchant. |
| `payer`            | `Address`             | Funding address. |
| `token`            | `Address`             | Token contract used. |
| `amount`           | `i128`                | Total payment amount (smallest unit). |
| `status`           | `PaymentStatus`       | `Completed`, `PartiallyRefunded`, or `FullyRefunded`. |
| `paid_at`          | `u64`                 | Unix timestamp of payment. |
| `refunded_amount`  | `i128`                | Cumulative refunded amount so far. |
| `memo`             | `String`              | Optional free-text note. |
| `tags`             | `Option<Vec<String>>` | Optional string tags. |
| `platform_fee`     | `i128`                | Fee deducted by the platform (0 if no fee configured). |

---

### `PaymentSummary`

| Field              | Type            | Description |
|--------------------|-----------------|-------------|
| `order_id`         | `String`        | Unique order identifier. |
| `merchant_address` | `Address`       | Receiving merchant. |
| `amount`           | `i128`          | Payment amount. |
| `token`            | `Address`       | Token contract used. |
| `status`           | `PaymentStatus` | Current payment status. |
| `paid_at`          | `u64`           | Unix timestamp of payment. |

---

### `RefundRecord`

| Field        | Type           | Description |
|--------------|----------------|-------------|
| `refund_id`  | `String`       | Unique refund identifier. |
| `order_id`   | `String`       | Associated payment order. |
| `initiator`  | `Address`      | Address that initiated the refund. |
| `amount`     | `i128`         | Refund amount. |
| `reason`     | `String`       | Reason text. |
| `status`     | `RefundStatus` | `Pending`, `Approved`, `Rejected`, or `Completed`. |
| `created_at` | `u64`          | Unix timestamp of creation. |

---

### `MultisigPayment`

| Field                 | Type              | Description |
|-----------------------|-------------------|-------------|
| `payment_id`          | `String`          | Unique multisig payment identifier. |
| `merchant_address`    | `Address`         | Receiving merchant. |
| `token`               | `Address`         | Token contract used. |
| `amount`              | `i128`            | Payment amount. |
| `required_signatures` | `u32`             | Number of signatures needed to execute. |
| `signers`             | `Vec<Address>`    | Authorised signers. |
| `signatures`          | `Vec<Bytes>`      | Collected signature bytes. |
| `signed_by`           | `Vec<Address>`    | Addresses that have already signed. |
| `executed`            | `bool`            | `true` if payment has been executed. |
| `cancelled`           | `bool`            | `true` if payment has been cancelled. |
| `initiator`           | `Address`         | Address that created the payment. |
| `created_at`          | `u64`             | Unix timestamp of creation. |
| `expires_at`          | `Option<u64>`     | Unix timestamp of expiry. |

---

### `PaymentFilter`

| Field        | Type              | Description |
|--------------|-------------------|-------------|
| `date_start` | `Option<u64>`     | Filter payments on or after this Unix timestamp. |
| `date_end`   | `Option<u64>`     | Filter payments on or before this Unix timestamp. |
| `amount_min` | `Option<i128>`    | Minimum payment amount (inclusive). |
| `amount_max` | `Option<i128>`    | Maximum payment amount (inclusive). |
| `token`      | `Option<Address>` | Filter by token contract address. |
| `status`     | `StatusFilter`    | `Any`, `Completed`, `PartiallyRefunded`, or `FullyRefunded`. |
| `tag`        | `Option<String>`  | Filter by a specific tag value. |

---

### `PaymentPage`

| Field           | Type                | Description |
|-----------------|---------------------|-------------|
| `payments`      | `Vec<PaymentOrder>` | Records for the current page. |
| `next_cursor`   | `Option<String>`    | `order_id` to pass as `cursor` for the next page; `null` if no more pages. |
| `total_matching`| `u32`               | Total count of records matching the query before the page limit is applied. |

---

### `GlobalStats`

| Field                | Type   | Description |
|----------------------|--------|-------------|
| `total_payments`     | `u32`  | All-time count of completed payments. |
| `total_volume`       | `i128` | All-time aggregate payment volume (saturating). |
| `total_refunds`      | `u32`  | All-time count of executed refunds. |
| `total_refund_volume`| `i128` | All-time aggregate refund volume (saturating). |
| `active_merchants`   | `u32`  | Current count of active merchant profiles. |

---

### `BatchPaymentItem`

| Field                 | Type      | Description |
|-----------------------|-----------|-------------|
| `order_id`            | `String`  | Unique order identifier for this item. |
| `merchant_address`    | `Address` | Receiving merchant. |
| `token_address`       | `Address` | Token contract address. |
| `amount`              | `i128`    | Payment amount (positive). |
| `memo`                | `String`  | Optional note. |
| `signature`           | `Bytes`   | 64-byte ed25519 signature from merchant's key. |
| `merchant_public_key` | `Bytes`   | 32-byte ed25519 public key. |
