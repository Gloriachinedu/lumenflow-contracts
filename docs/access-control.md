# Contract Storage Access Control

This document describes the access control model for all contract read (query) and write operations in LumenFlow. It covers which functions are publicly accessible, which require caller authentication, and what error is returned when an unauthorized call is attempted.

## Overview

LumenFlow enforces access control at the contract entry-point level using Soroban's built-in `require_auth()` mechanism combined with application-level identity checks. All sensitive queries require the caller to authenticate and be a recognized participant (payer, merchant, or admin).

Two core helpers in `helper.rs` underpin the access control logic:

| Helper | Behaviour |
|---|---|
| `require_admin(env, caller)` | Reads the stored admin address; returns `Unauthorized` if caller does not match or no admin is set |
| `require_admin_or(env, caller, other)` | Passes if caller is the admin **or** equals `other`; otherwise returns `Unauthorized` |

---

## Public Read Functions

The following functions do **not** require authentication. Any caller may invoke them:

| Function | Returns | Notes |
|---|---|---|
| `get_merchant(merchant_address)` | `Merchant` | Full merchant profile including `verified` flag; publicly readable by design so payers can inspect merchant details before paying |
| `is_registered(merchant_address)` | `bool` | Lightweight registration check; safe to expose publicly |
| `get_payment_summary(order_id)` | `PaymentSummary` | Subset of payment data (no payer address); exposes only public-safe fields |
| `get_refund(refund_id)` | `RefundRecord` | Public read; refund IDs are opaque and difficult to enumerate |
| `get_contract_version()` | `String` | Contract metadata; no sensitive data |

---

## Authenticated Read Functions

The following functions require the caller to authenticate and pass an identity check:

### Payment Queries

| Function | Required Auth | Error if Unauthorized |
|---|---|---|
| `get_payment_by_id(caller, order_id)` | Caller must be the **payer**, **merchant**, or **admin** of the payment | `PaymentError::Unauthorized` |
| `get_merchant_payment_history(merchant, ...)` | Caller must be the **merchant** (own history only) | Auth failure (Soroban host) |
| `get_payer_payment_history(payer, ...)` | Caller must be the **payer** (own history only) | Auth failure (Soroban host) |
| `get_global_payment_stats(admin, ...)` | Caller must be the **admin** | `PaymentError::Unauthorized` |
| `get_merchant_stats(merchant)` | Caller must be the **merchant** | Auth failure (Soroban host) |
| `get_refunds_for_order(caller, order_id)` | Caller must be the **payer**, **merchant**, or **admin** | `PaymentError::Unauthorized` |
| `get_multisig_payment(caller, payment_id)` | Caller must be the **admin**, **merchant**, or a **signer** on the multisig | `PaymentError::Unauthorized` |

### Merchant Management (Admin-only)

| Function | Required Auth | Error if Unauthorized |
|---|---|---|
| `get_merchants(admin, ...)` | **Admin** only (paginated merchant list) | `PaymentError::Unauthorized` |
| `deactivate_merchant(admin, ...)` | **Admin** only | `PaymentError::Unauthorized` |
| `reactivate_merchant(admin, ...)` | **Admin** only | `PaymentError::Unauthorized` |
| `verify_merchant(admin, ...)` | **Admin** only | `PaymentError::Unauthorized` |
| `unverify_merchant(admin, ...)` | **Admin** only | `PaymentError::Unauthorized` |

---

## Access Control Enforcement

### Step 1 — Soroban `require_auth()`

For every function that requires a specific caller, that caller's address is passed as a parameter and `address.require_auth()` is called immediately. This causes the Soroban host to validate that the transaction was signed by the appropriate key. If authentication fails, the host aborts the call before any application logic runs.

### Step 2 — Identity Check

After authentication, the contract verifies the caller is the expected participant:

```rust
// Example: get_payment_by_id
caller.require_auth();   // Step 1: Soroban auth
let payment = storage::get_payment(&env, &order_id).ok_or(PaymentError::PaymentNotFound)?;
let is_admin = storage::get_admin(&env).map_or(false, |a| a == caller);
if !is_admin && caller != payment.payer && caller != payment.merchant_address {
    return Err(PaymentError::Unauthorized);  // Step 2: identity check
}
```

This two-step approach ensures:
1. The caller cannot forge their identity (Soroban cryptographic guarantee).
2. A legitimate caller cannot access another party's private data (application-level guard).

---

## Security Rationale

| Function | Why auth is required |
|---|---|
| `get_payment_by_id` | Contains the payer address and full payment metadata. Restricting to payer/merchant/admin prevents information leakage about who paid whom. |
| `get_merchant_payment_history` | Merchant revenue data is commercially sensitive. Only the merchant and admin should see it. |
| `get_payer_payment_history` | Payment patterns reveal personal spending behaviour. Only the payer and admin should see it. |
| `get_global_payment_stats` | Aggregate network data is admin-only to prevent competitive intelligence extraction. |
| `get_refunds_for_order` | Refund records contain the initiator address and reason. Restricted to parties involved in the payment. |
| `get_multisig_payment` | Multisig payment details include signer lists and collected signatures. Restricted to participants. |
| `get_merchants` (paginated) | Full merchant list with all profile data. Admin-only to prevent bulk data scraping. |

---

## Public vs. Restricted — Quick Reference

```
Public (no auth):
  get_merchant, is_registered, get_payment_summary,
  get_refund, get_contract_version

Restricted (caller must auth + identity check):
  get_payment_by_id         → payer | merchant | admin
  get_merchant_payment_history → merchant only
  get_payer_payment_history    → payer only
  get_global_payment_stats     → admin only
  get_merchant_stats           → merchant only
  get_refunds_for_order        → payer | merchant | admin
  get_multisig_payment         → admin | merchant | signer
  get_merchants                → admin only
```

---

## Related Documents

- [`docs/auth-model.md`](auth-model.md) — Complete auth table for all contract functions
- [`contracts/lumenflow/src/helper.rs`](../contracts/lumenflow/src/helper.rs) — `require_admin`, `require_admin_or` implementations
- [`contracts/lumenflow/src/lib.rs`](../contracts/lumenflow/src/lib.rs) — Contract entry points with inline auth comments
