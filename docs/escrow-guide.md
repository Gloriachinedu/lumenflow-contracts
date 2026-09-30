# Time-Locked Payment Escrow Guide

LumenFlow supports trustless conditional payments via two escrow mechanisms:

1. **Time-locked escrow** (`create_escrow` / `release_escrow` / `cancel_escrow_before_lock`) — funds held until a timestamp expires.
2. **Conditional escrow hold** (`escrow_hold` / `escrow_release` / `escrow_cancel`) — funds locked until an arbiter releases them, with a timeout fallback. *(Issue #1111)*

---

## Overview

### Time-Locked Escrow

```
Payer                   Contract                  Merchant
  │                        │                         │
  │── create_escrow ───────►│  (funds locked)         │
  │                        │                         │
  │      [ time passes… unlock_at reached ]          │
  │                        │                         │
  │                        │◄──── release_escrow ────│
  │                        │──── transfer funds ─────►│
  │                        │                         │
  ─── OR (before unlock_at) ───────────────────────────
  │── cancel_escrow_before_lock ──►│                  │
  │◄── refund ─────────────│                         │
```

### Conditional Escrow Hold (Issue #1111)

```
Payer                   Contract              Arbiter / Merchant
  │                        │                         │
  │── escrow_hold ─────────►│  (funds locked,          │
  │   + condition_hash      │   condition recorded)   │
  │                        │                         │
  │                        │◄──── escrow_release ────│
  │                        │   (arbiter any time, or │
  │                        │    anyone after timeout) │
  │                        │──── transfer funds ─────►│
  │                        │                         │
  ─── OR (before timeout_at) ──────────────────────────
  │── escrow_cancel ───────►│                         │
  │◄── refund ─────────────│                         │
```

---

## Conditional Escrow Hold Functions (Issue #1111)

### `escrow_hold`

Locks funds and records a SHA-256 `condition_hash` commitment on-chain. An `arbiter` address is designated to authorise the release.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $PAYER_KEY --network $NETWORK \
  -- escrow_hold \
  --payer $PAYER_ADDR \
  --escrow_id "HOLD_001" \
  --merchant $MERCHANT_ADDR \
  --token $TOKEN_ADDR \
  --amount 5000 \
  --condition_hash "<32-byte-sha256-hash-hex>" \
  --arbiter $ARBITER_ADDR \
  --timeout_at 1785000000
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `payer` | Address funding the escrow. Must sign the call. |
| `escrow_id` | Unique, non-empty identifier. Max 64 characters. |
| `merchant` | Registered, active merchant that receives funds on release. |
| `token` | Allowed token contract address. |
| `amount` | Positive amount in stroops. |
| `condition_hash` | SHA-256 hash (exactly 32 bytes) of the off-chain condition document. |
| `arbiter` | Address authorised to call `escrow_release` before `timeout_at`. |
| `timeout_at` | Unix timestamp. After this the merchant (or anyone) can trigger release. |

**Returns:** The created `EscrowHold` record.

**Errors:**

| Error | Cause |
|-------|-------|
| `InvalidAmount` | `amount` ≤ 0 |
| `InvalidInput` | `escrow_id` empty, `timeout_at` ≤ now, or `condition_hash` ≠ 32 bytes |
| `TokenNotAllowed` | `token` not on the allow-list |
| `EscrowAlreadyExists` | An escrow with `escrow_id` already exists |
| `MerchantNotFound` | No merchant registered at `merchant` |
| `MerchantInactive` | Merchant has been deactivated |

---

### `escrow_release`

Releases funds to the merchant. Can be called by the **arbiter** at any time, or by **anyone** after `timeout_at`.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ARBITER_KEY --network $NETWORK \
  -- escrow_release \
  --caller $ARBITER_ADDR \
  --escrow_id "HOLD_001"
```

**Errors:**

| Error | Cause |
|-------|-------|
| `EscrowNotFound` | No hold with `escrow_id` |
| `EscrowAlreadyFinalised` | Hold already released or cancelled |
| `EscrowNotUnlocked` | Caller is not arbiter and `timeout_at` has not passed |

---

### `escrow_cancel`

Returns locked funds to the payer. Only the **original payer** may cancel, and only **before** `timeout_at`.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $PAYER_KEY --network $NETWORK \
  -- escrow_cancel \
  --caller $PAYER_ADDR \
  --escrow_id "HOLD_001"
```

**Errors:**

| Error | Cause |
|-------|-------|
| `EscrowNotFound` | No hold with `escrow_id` |
| `EscrowAlreadyFinalised` | Hold already released or cancelled |
| `EscrowUnauthorised` | Caller is not the payer |
| `EscrowLockExpired` | `timeout_at` passed; call `escrow_release` instead |

---

### `get_escrow_hold`

Read the current state of a conditional escrow hold.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY --network $NETWORK \
  -- get_escrow_hold \
  --escrow_id "HOLD_001"
```

Returns an `EscrowHold` record:

```json
{
  "escrow_id": "HOLD_001",
  "payer": "G...",
  "merchant": "G...",
  "token": "C...",
  "amount": 5000,
  "condition_hash": "<32 bytes hex>",
  "arbiter": "G...",
  "timeout_at": 1785000000,
  "status": "Held",
  "created_at": 1784996400
}
```

**Status values:** `Held` | `Released` | `Cancelled`

---

## State Machine — Conditional Escrow Hold

```
         escrow_hold
              │
              ▼
            Held
           /    \
escrow_cancel    escrow_release
(payer only,    (arbiter any time,
 before         or anyone after
 timeout_at)    timeout_at)
      │               │
      ▼               ▼
  Cancelled        Released
```

---

## Events — Conditional Escrow Hold

| Event | Trigger | Payload |
|-------|---------|---------|
| `lumenflow/escrow_held` | `escrow_hold` succeeds | `(escrow_id, payer, merchant, amount, condition_hash)` |
| `lumenflow/escrow_released` | `escrow_release` succeeds | `(escrow_id, merchant, amount)` |
| `lumenflow/escrow_cancelled` | `escrow_cancel` succeeds | `(escrow_id, payer, amount)` |

---

## Integration Tests

The test suite in `contracts/lumenflow/src/test.rs` covers:

- **Hold → Release (arbiter):** Arbiter calls `escrow_release` before timeout.
- **Hold → Release (timeout):** Anyone calls `escrow_release` after `timeout_at`.
- **Hold → Cancel:** Payer calls `escrow_cancel` before timeout.
- **Cancel after timeout:** Must fail with `EscrowLockExpired`.
- **Double release:** Must fail with `EscrowAlreadyFinalised`.
- **Non-payer cancel:** Must fail with `EscrowUnauthorised`.
- **Non-arbiter early release:** Must fail with `EscrowNotUnlocked`.

---

## Time-Locked Escrow Functions (Original API)

### `create_escrow`

Locks `amount` tokens from the payer into the contract address.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $PAYER_KEY --network $NETWORK \
  -- create_escrow \
  --payer $PAYER_ADDR \
  --merchant $MERCHANT_ADDR \
  --amount 5000 \
  --token $TOKEN_ADDR \
  --unlock_at 1785000000 \
  --order_id "ESCROW_001"
```

**Parameters:**

| Parameter | Description |
|-----------|-------------|
| `payer` | Address funding the escrow. Must sign the call. |
| `merchant` | Registered, active merchant that receives funds on release. |
| `amount` | Positive token amount (in stroops). |
| `token` | Allowed token contract address. |
| `unlock_at` | Unix timestamp after which `release_escrow` is valid. Must be in the future. |
| `order_id` | Unique, non-empty identifier. Max 64 characters. |

**Errors:**

| Error | Cause |
|-------|-------|
| `InvalidAmount` | `amount` ≤ 0 |
| `InvalidInput` | `order_id` empty or `unlock_at` ≤ current timestamp |
| `TokenNotAllowed` | `token` not on the allow-list |
| `EscrowAlreadyExists` | An escrow with `order_id` already exists |
| `MerchantNotFound` | No merchant registered at `merchant` |
| `MerchantInactive` | Merchant has been deactivated |

---

### `release_escrow`

Transfers locked funds to the merchant.  Can be called by **anyone** once
`unlock_at` has passed.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY --network $NETWORK \
  -- release_escrow \
  --order_id "ESCROW_001"
```

**Errors:**

| Error | Cause |
|-------|-------|
| `EscrowNotFound` | No escrow with `order_id` |
| `EscrowAlreadyFinalised` | Escrow already released or cancelled |
| `EscrowNotUnlocked` | Current timestamp < `unlock_at` |

---

### `cancel_escrow_before_lock`

Returns locked funds to the payer.  Only the **original payer** may cancel,
and only **before** `unlock_at`.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $PAYER_KEY --network $NETWORK \
  -- cancel_escrow_before_lock \
  --payer $PAYER_ADDR \
  --order_id "ESCROW_001"
```

**Errors:**

| Error | Cause |
|-------|-------|
| `EscrowNotFound` | No escrow with `order_id` |
| `EscrowAlreadyFinalised` | Escrow already released or cancelled |
| `EscrowUnauthorised` | Caller is not the escrow payer |
| `EscrowLockExpired` | Current timestamp ≥ `unlock_at` (use `release_escrow` instead) |

---

### `get_escrow`

Read the current state of a time-locked escrow.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY --network $NETWORK \
  -- get_escrow \
  --order_id "ESCROW_001"
```

Returns an `EscrowRecord`:

```json
{
  "order_id": "ESCROW_001",
  "payer": "G...",
  "merchant": "G...",
  "token": "C...",
  "amount": 5000,
  "unlock_at": 1785000000,
  "status": "Locked",
  "created_at": 1784996400
}
```

**Status values:** `Locked` | `Released` | `Cancelled`

---

## State Machine — Time-Locked Escrow

```
         create_escrow
              │
              ▼
           Locked
          /       \
cancel_before_lock  release_escrow
(before unlock_at)  (after unlock_at)
         │                 │
         ▼                 ▼
     Cancelled          Released
```

---

## Events — Time-Locked Escrow

| Event | Trigger | Payload |
|-------|---------|---------|
| `lumenflow/escrow_created` | `create_escrow` succeeds | `(order_id, amount)` |
| `lumenflow/escrow_released` | `release_escrow` succeeds | `(order_id, amount)` |
| `lumenflow/escrow_cancelled` | `cancel_escrow_before_lock` succeeds | `(order_id, amount)` |

---

## Use cases

### Delivery confirmation (conditional escrow)

A buyer locks funds in a conditional escrow. The `condition_hash` commits to a delivery-confirmation document. On delivery the arbiter (e.g. a logistics oracle) calls `escrow_release`. If delivery fails before the timeout the buyer calls `escrow_cancel`.

### Service milestone (conditional escrow)

A client locks funds for a freelancer with an arbiter (e.g. a project manager or DAO). On milestone completion the arbiter releases. If the project is cancelled before timeout the client cancels.

### Simple delivery confirmation (time-locked)

A buyer pays into time-locked escrow when placing an order. `unlock_at` is set to the expected delivery date plus a buffer. Once the timer expires the merchant calls `release_escrow`. If the buyer wants to cancel before delivery they call `cancel_escrow_before_lock`.

---

## Security notes

- Funds are held by the **contract address** itself, not by admin storage.
- `escrow_release` is **permissionless** after `timeout_at` — any address (including the merchant or a keeper bot) can trigger it.
- `escrow_cancel` requires the **payer's signature**. The arbiter cannot unilaterally return funds.
- The `condition_hash` is stored for auditability but is **not evaluated** inside the contract — off-chain verification is the arbiter's responsibility.
- The contract must be unpaused for all escrow operations.

---

## Error reference

Full error codes and remediation steps: [`docs/errors.md`](errors.md).

| Code | Name | Remediation |
|------|------|-------------|
| 100 | `EscrowNotFound` | Verify the `order_id` or `escrow_id` |
| 101 | `EscrowAlreadyExists` | Use a unique `order_id` or `escrow_id` |
| 102 | `EscrowNotUnlocked` | Wait until `unlock_at` / `timeout_at` before releasing |
| 103 | `EscrowAlreadyFinalised` | Escrow is complete; no further action needed |
| 104 | `EscrowUnauthorised` | Only the payer can cancel |
| 105 | `EscrowLockExpired` | Timeout passed; call `escrow_release` instead |
