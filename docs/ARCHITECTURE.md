# LumenFlow Architecture

This document describes the high-level architecture of LumenFlow and the data flows between its main components.

---

## Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Layer                             │
│                                                                 │
│   ┌──────────────────┐        ┌───────────────────────────┐    │
│   │  Frontend (HTML) │        │  CLI (lumenflow-cli)       │    │
│   │  frontend/       │        │  cli/lumenflow-cli/        │    │
│   └────────┬─────────┘        └────────────┬──────────────┘    │
│            │                               │                    │
│            └──────────────┬────────────────┘                    │
│                           │  TypeScript SDK                     │
│                   ┌───────┴──────────┐                          │
│                   │  sdk/src/        │                          │
│                   │  signPayment,    │                          │
│                   │  wallet, errors  │                          │
│                   └───────┬──────────┘                          │
└───────────────────────────┼─────────────────────────────────────┘
                            │  Stellar RPC / Horizon
                            ▼
┌───────────────────────────────────────────────────────────────┐
│                   Soroban Smart Contract                       │
│                   contracts/lumenflow/src/                     │
│                                                                │
│  lib.rs ──► types.rs ──► storage.rs                           │
│     │                       │                                  │
│     └──► helper.rs          └──► Persistent / Instance /      │
│     └──► error.rs                Temporary storage            │
└───────────────────────────────────────────────────────────────┘
```

### Component Roles

| Component | Location | Role |
|---|---|---|
| Frontend | `frontend/` | HTML UI for payments, multisig, and history |
| Dashboard | `dashboard/` | Merchant-facing portal and stats |
| SDK | `sdk/src/` | TypeScript helpers — payload signing, wallet connection, error types |
| CLI | `cli/lumenflow-cli/` | Command-line invoker for contract functions |
| Contract | `contracts/lumenflow/src/` | Core on-chain logic (Soroban/Rust) |
| CI/CD | `.github/workflows/` | Lint, test, WASM build, size checks, testnet deploy |
| Scripts | `scripts/` | Local network setup, deploy, smoke tests |

---

## Merchant Registration Flow

```mermaid
sequenceDiagram
    participant F as Frontend / CLI
    participant S as SDK
    participant C as Contract (lib.rs)
    participant St as Storage

    F->>S: build register_merchant call
    S->>C: invoke register_merchant(address, name, description, contact, category)
    C->>St: get_merchant(address) — check not already registered
    C->>St: set_merchant(Merchant { active: true, verified: false, ... })
    C->>St: add_to_merchant_list(address)
    C->>St: update GlobalStats.active_merchants += 1
    C-->>F: Ok / emit lumenflow/merchant_registered
```

---

## Payment Processing Flow

```mermaid
sequenceDiagram
    participant P as Payer (Frontend/SDK)
    participant C as Contract
    participant T as Token Contract (SEP-41)
    participant St as Storage

    P->>C: process_payment_with_signature(payer, order_id, merchant, token, amount, memo, sig, pubkey)
    C->>St: get_payment(order_id) — reject if duplicate
    C->>C: verify ed25519 signature over (order_id + merchant + token + amount + memo)
    C->>St: get_merchant(merchant) — must be active
    C->>T: transfer(payer → merchant, amount)
    C->>St: set_payment(PaymentOrder { status: Completed, ... })
    C->>St: add_merchant_payment_id / add_payer_payment_id
    C->>St: update GlobalStats (total_payments, total_volume)
    C-->>P: Ok / emit lumenflow/payment_processed
```

---

## Refund Lifecycle Flow

```mermaid
stateDiagram-v2
    [*] --> Pending : initiate_refund (payer or merchant)
    Pending --> Approved : approve_refund (merchant or admin)
    Pending --> Rejected : reject_refund (merchant or admin)
    Approved --> Completed : execute_refund (merchant signs token transfer)
    Pending --> Disputed : raise_dispute
    Disputed --> Approved : admin resolves FavorPayer
    Disputed --> Rejected : admin resolves FavorMerchant
    Rejected --> [*]
    Completed --> [*]
```

```mermaid
sequenceDiagram
    participant I as Initiator (Payer/Merchant)
    participant M as Merchant
    participant C as Contract
    participant T as Token Contract
    participant St as Storage

    I->>C: initiate_refund(caller, refund_id, order_id, amount, reason)
    C->>St: get_payment(order_id) — validate window (≤30 days) & amount
    C->>St: set_refund(RefundRecord { status: Pending })
    M->>C: approve_refund(caller, refund_id)
    C->>St: update RefundRecord { status: Approved }
    M->>C: execute_refund(refund_id)
    C->>T: transfer(merchant → payer, amount)
    C->>St: update PaymentOrder.refunded_amount / status
    C->>St: update GlobalStats (total_refunds, total_refund_volume)
    C-->>M: Ok / emit lumenflow/refund_executed
```

---

## Multi-Signature Payment Flow

```mermaid
sequenceDiagram
    participant I as Initiator
    participant S1 as Signer 1
    participant S2 as Signer N
    participant C as Contract
    participant T as Token Contract
    participant St as Storage

    I->>C: initiate_multisig_payment(initiator, payment_id, merchant, token, amount, signers[], required_signatures)
    C->>St: set_multisig(MultisigPayment { executed: false, signatures: [], signed_by: [] })
    C-->>I: emit lumenflow/multisig_initiated

    S1->>C: sign_multisig_payment(signer, payment_id, signature)
    C->>St: append signature + signer address; verify signer is in signers[]

    S2->>C: sign_multisig_payment(signer, payment_id, signature)
    C->>St: append signature + signer address

    I->>C: execute_multisig_payment(payer, payment_id)
    C->>St: get_multisig — verify signatures.len() >= required_signatures
    C->>T: transfer(payer → merchant, amount)
    C->>St: update MultisigPayment { executed: true }
    C-->>I: emit lumenflow/multisig_executed
```

---

## Replay Protection and Nonce Model

Each payer has an associated `PayerNonce` (u64) stored in contract persistent storage.

- Payments submitted via `process_payment_with_nonce` must supply the expected current nonce value.
- On successful processing the contract increments the payer's nonce by 1.
- If the supplied nonce does not match the stored value, the contract rejects with `InvalidNonce`.

This design is necessary because Soroban does not provide a universal per-account sequence number at the contract entrypoint level. An on-chain per-payer counter provides deterministic replay protection tied to the payer's address.

Tests: see `contracts/lumenflow/src/test.rs` for integration tests that verify nonce increment and replay rejection.

---

## Storage Layout

| Key | Type | Tier | Description |
|---|---|---|---|
| `Admin` | `Address` | Instance | Contract administrator |
| `GlobalStats` | `GlobalStats` | Instance | Aggregate counters |
| `MerchantList` | `Vec<Address>` | Instance | All registered merchant addresses |
| `CleanupPeriod` | `u64` | Instance | Payment expiry window (seconds) |
| `Merchant(addr)` | `Merchant` | Persistent | Per-merchant profile |
| `Payment(id)` | `PaymentOrder` | Persistent | Per-payment record |
| `MerchantPayments(addr)` | `Vec<String>` | Persistent | Payment IDs for a merchant |
| `PayerPayments(addr)` | `Vec<String>` | Persistent | Payment IDs for a payer |
| `Refund(id)` | `RefundRecord` | Persistent | Per-refund record |
| `Multisig(id)` | `MultisigPayment` | Persistent | Per-multisig payment |
| `PaymentRequest(id)` | `PaymentRequest` | Temporary | Short-lived payment request |
