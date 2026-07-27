# Time-Locked Payment Escrow Guide

LumenFlow supports trustless conditional payments via a time-locked escrow
mechanism.  Funds are held inside the contract until a configurable `unlock_at`
timestamp, after which the merchant can collect them.  If circumstances change
before that time the payer can cancel and recover their funds.

---

## Overview

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

---

## Contract functions

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

Read the current state of an escrow.

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

## Events

| Event | Trigger | Payload |
|-------|---------|---------|
| `lumenflow/escrow_created` | `create_escrow` succeeds | `(order_id, amount)` |
| `lumenflow/escrow_released` | `release_escrow` succeeds | `(order_id, amount)` |
| `lumenflow/escrow_cancelled` | `cancel_escrow_before_lock` succeeds | `(order_id, amount)` |

---

## State machine

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

## Use cases

### Delivery confirmation

A buyer pays into escrow when placing an order.  The `unlock_at` is set to the
expected delivery date plus a buffer.  Once delivery is confirmed (or the timer
expires) the merchant calls `release_escrow`.  If the buyer wants to cancel
before delivery they call `cancel_escrow_before_lock`.

### Service milestone

A client locks funds for a freelancer.  `unlock_at` is the project deadline.
If the freelancer delivers before the deadline the client does nothing — the
freelancer calls `release_escrow` after the deadline.  If the project is
cancelled before the deadline the client calls `cancel_escrow_before_lock`.

---

## Security notes

- Funds are held by the **contract address** itself, not by admin storage.
  The contract transfers them on release or cancel.
- `release_escrow` is **permissionless** after `unlock_at` — any address
  (including the merchant or a keeper bot) can trigger it.
- `cancel_escrow_before_lock` requires the **payer's signature**.  The merchant
  cannot unilaterally return funds.
- The contract must be unpaused for all escrow operations.

---

## Error reference

Full error codes and remediation steps: [`docs/errors.md`](errors.md).

| Code | Name | Remediation |
|------|------|-------------|
| 100 | `EscrowNotFound` | Verify the `order_id` |
| 101 | `EscrowAlreadyExists` | Use a unique `order_id` |
| 102 | `EscrowNotUnlocked` | Wait until `unlock_at` before releasing |
| 103 | `EscrowAlreadyFinalised` | Escrow is complete; no further action needed |
| 104 | `EscrowUnauthorised` | Only the payer can cancel |
| 105 | `EscrowLockExpired` | `unlock_at` passed; call `release_escrow` instead |
