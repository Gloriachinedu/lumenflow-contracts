# User Journey Documentation

**Issue:** [#369](https://github.com/Gloriachinedu/lumenflow-contracts/issues/369)  
**Status:** Complete  
**Labels:** product, documentation, planning

---

## Overview

This document defines the primary user stories and role-specific workflows for the
LumenFlow platform. It maps each role's actions to the corresponding UI pages and
smart contract calls, and is intended to support product planning, onboarding, and
prioritization decisions.

### Roles

| Role | Description |
|---|---|
| **Payer** | Any person or system sending a payment to a merchant |
| **Merchant** | A registered business or individual accepting payments |
| **Admin** | The privileged operator who manages global contract configuration |
| **Auditor** | A read-only stakeholder (accountant, regulator) reviewing transaction history |

---

## 1. Payer Journey

### Goal
Send a payment to a merchant, receive a receipt, and optionally request a refund.

### User story
> As a payer, I want to pay a merchant quickly using my Stellar wallet, receive a
> shareable receipt, and be able to request a refund if something goes wrong.

### Flow

```
Connect wallet → Review payment request → Approve transaction
    → View receipt → (optionally) Request refund
```

### Step-by-step

| Step | Action | UI Page | Contract Call |
|---|---|---|---|
| 1 | Install and connect Freighter wallet | Any page | — |
| 2 | Open a payment link from the merchant | `receipt.html?orderId=...` or merchant checkout | — |
| 3 | Review amount, merchant name, and token | Payment confirmation UI | `get_payment_summary` |
| 4 | Sign and submit transaction | Wallet popup (Freighter) | `process_payment_with_signature` |
| 5 | View receipt confirming payment | `receipt.html?orderId=ORDER_XXX` | `get_payment_summary` |
| 6 | Share receipt link (optional) | Receipt page → Copy Link | — |
| 7 | Initiate refund request (optional) | Receipt page / support flow | `initiate_refund` |
| 8 | Track refund status | Receipt page / refund status view | `get_refund` |

### Key screens
- `frontend/receipt.html` — displays confirmation and refund history for a given order
- `frontend/history.html` — payer's full payment history with filters

### Edge cases and error states

| Scenario | Expected behaviour |
|---|---|
| Order ID not found | "Receipt not found" page with suggested next steps; no error details leaked |
| Payment already exists (duplicate order ID) | Contract returns `DuplicateOrderId` error; payer sees a clear message |
| Wallet not connected | Page prompts wallet connection before allowing signing |
| Refund window expired (>30 days) | `initiate_refund` returns `RefundWindowExpired`; UI shows friendly message |
| Refund amount too small (<100 stroops) | `initiate_refund` returns `RefundAmountTooSmall` |

---

## 2. Merchant Journey

### Goal
Register a business, start accepting payments, manage refunds, and review settlement history.

### User story
> As a merchant, I want to register my business on-chain, generate payment requests,
> approve or reject refunds from customers, and export my payment history for
> accounting.

### Flow

```
Register → Configure payment requests → Accept payments
    → Manage refunds → Review history & export
```

### Step-by-step

#### 2a. Onboarding

| Step | Action | UI Page | Contract Call |
|---|---|---|---|
| 1 | Connect Stellar wallet | Dashboard | — |
| 2 | Check if already registered | Dashboard | `is_registered` |
| 3 | Submit registration form (name, category, contact) | Dashboard → Register | `register_merchant` |
| 4 | (Optional) Request admin verification for the verified badge | Contact admin | `verify_merchant` (admin) |
| 5 | View merchant profile | Dashboard | `get_merchant` |

#### 2b. Accepting a payment

| Step | Action | UI Page | Contract Call |
|---|---|---|---|
| 1 | Build a signed payment payload for a customer order | SDK / CLI | `sign_payment_payload` (SDK) |
| 2 | Share payment link or embed payment button | Storefront / email | — |
| 3 | Payment confirmed on-chain | — | `process_payment_with_signature` (payer-initiated) |
| 4 | Receive `lumenflow/payment_processed` event | Backend webhook | Horizon SSE |
| 5 | Update order status in your system | Backend | — |

#### 2c. Managing refunds

| Step | Action | UI Page | Contract Call |
|---|---|---|---|
| 1 | Receive refund request from payer | Notification / dashboard | — |
| 2 | Review refund reason and amount | Dashboard | `get_refund` |
| 3 | Approve or reject | Dashboard | `approve_refund` / `reject_refund` |
| 4 | Execute refund (on approval) — transfers tokens to payer | Dashboard | `execute_refund` |
| 5 | Confirm refund status updated on receipt | Receipt page | `get_payment_summary` |

#### 2d. History and settlement

| Step | Action | UI Page | Contract Call |
|---|---|---|---|
| 1 | Open payment history | `frontend/history.html` | `get_merchant_payment_history` |
| 2 | Filter by date, token, or status | History page filters | `get_merchant_payment_history` (with filter) |
| 3 | View aggregate stats | Dashboard stats card | `get_merchant_stats` |
| 4 | Export settlement report (future) | Dashboard → Export | `get_merchant_payment_history` (paginated) |

### Key screens
- `dashboard/merchant-dashboard/index.html` — main merchant dashboard
- `frontend/history.html` — paginated payment history with filters
- `frontend/receipt.html` — per-order receipt and refund history

### Edge cases and error states

| Scenario | Expected behaviour |
|---|---|
| Merchant not registered | Dashboard shows registration prompt |
| Deactivated account | Contract returns `MerchantDeactivated`; dashboard shows reactivation instructions |
| Refund cumulative total exceeds payment | Contract returns `RefundExceedsPayment`; merchant sees clear error |
| Multi-sig payment awaiting approvals | Dashboard shows pending approval count and signer list |

---

## 3. Admin Journey

### Goal
Bootstrap the contract, manage allowed tokens, monitor global platform health, and handle escalations.

### User story
> As an admin, I want to configure the contract once at deployment, manage which
> tokens are accepted, verify merchants, respond to escalations, and monitor
> platform-wide payment volume and anomalies.

### Flow

```
Deploy & initialise → Configure tokens & fees → Verify merchants
    → Monitor global stats → Handle escalations → Maintain contract
```

### Step-by-step

#### 3a. Initial setup (one-time)

| Step | Action | CLI / Contract Call |
|---|---|---|
| 1 | Deploy the contract WASM to Stellar | `./scripts/deploy.sh` |
| 2 | Initialise admin address | `set_admin --admin <ADMIN_ADDR>` |
| 3 | Add allowed token(s) | `add_allowed_token --token <TOKEN_ADDR>` |
| 4 | Set platform fee (if applicable) | `set_platform_fee --fee_bps 250 --fee_recipient <ADDR>` |
| 5 | Set refund window | `set_refund_window --window_secs 2592000` |
| 6 | Set minimum refund amount | `set_min_refund_amount --amount 100` |
| 7 | Set payment cleanup period | `set_payment_cleanup_period --period 7776000` |
| 8 | Set multisig expiry duration | `set_multisig_expiry_duration --duration 2592000` |

#### 3b. Merchant management

| Step | Action | Contract Call |
|---|---|---|
| 1 | Review registration requests | `get_merchants` (admin cursor-based list) |
| 2 | Verify trusted merchants | `verify_merchant --merchant_address <ADDR>` |
| 3 | Deactivate bad actors | `deactivate_merchant --merchant_address <ADDR>` |
| 4 | Reactivate merchants after review | `reactivate_merchant --merchant_address <ADDR>` |

#### 3c. Monitoring and incident response

| Step | Action | Contract Call / Tool |
|---|---|---|
| 1 | Check global payment volume and refund totals | `get_global_payment_stats` |
| 2 | Investigate suspicious activity alerts | Horizon SSE `lumenflow/suspicious_activity` event |
| 3 | Archive or clean up old payment records | `archive_payment_record` / `cleanup_expired_payments` |
| 4 | Pause contract during incident | `pause_contract` |
| 5 | Resume contract after resolution | `unpause_contract` |
| 6 | Transfer admin rights (key rotation) | `transfer_admin --new_admin <NEW_ADDR>` |

### Key tools
- `lumenflow` CLI — `lumenflow stats`, `lumenflow history`
- `./scripts/smoke_test.sh` — validate contract health end-to-end
- Horizon SSE + `docs/monitoring.md` — real-time event alerting

### Edge cases and error states

| Scenario | Expected behaviour |
|---|---|
| Admin not yet initialised | `set_admin` must be called before any admin-only functions |
| Attempt to add already-allowed token | Contract returns `TokenAlreadyAllowed` |
| Attempt to remove token with active payments | Operator should verify no in-flight payments before removing |
| Contract paused | All non-admin calls return `ContractPaused`; admin calls still work |

---

## 4. Auditor Journey

### Goal
Review transaction history, verify payment records, and produce reports for compliance or accounting.

### User story
> As an auditor, I want to inspect payment records for a specific merchant or date
> range, verify that refunds were processed correctly, and export data for reporting
> without needing to modify any contract state.

### Flow

```
Access read-only endpoints → Filter payment history
    → Verify refund records → Export for reporting
```

### Step-by-step

| Step | Action | UI Page / Contract Call |
|---|---|---|
| 1 | Obtain a Stellar keypair with view-only access (no signing authority over funds) | Wallet setup | — |
| 2 | Query merchant payment history for a period | `get_merchant_payment_history` with `date_start`/`date_end` filter |
| 3 | Spot-check individual payments by order ID | `get_payment_summary` (public) |
| 4 | Review refund records for disputed payments | `get_refunds_for_order` |
| 5 | Verify global volume and aggregate stats | `get_global_payment_stats` (admin access required) or `get_merchant_stats` |
| 6 | Export payment history as CSV/JSON | Settlement report feature (see `docs/merchant-payout-reporting.md`) |
| 7 | Cross-reference with Stellar Horizon transaction records | [Horizon API](https://developers.stellar.org/api/horizon) |

### Privacy considerations for auditors
- `get_payment_summary` is public and returns only non-sensitive metadata.
- `get_payment_by_id` requires a caller address and returns full payment details
  including payer address — access should be restricted to authorised parties.
- Payer addresses should be treated as personally identifiable information and
  handled in accordance with applicable data protection requirements.

### Key tools
- `frontend/history.html` — browsable payment history UI
- `docs/merchant-payout-reporting.md` — settlement report spec with field definitions
- [Stellar Expert](https://stellar.expert) — blockchain explorer for on-chain verification

---

## 5. Cross-cutting Concerns

### Wallet and authentication

All authenticated contract calls require the caller to sign the transaction with
their Stellar keypair. The browser UI uses [Freighter](https://www.freighter.app/)
for wallet signing. The CLI and SDK use a secret key from environment variables or
`.lumenflow.toml`.

| Caller type | Auth method |
|---|---|
| Browser user | Freighter wallet extension |
| CLI user | Secret key in `.lumenflow.toml` or `LUMENFLOW_SOURCE` env var |
| Backend integration | SDK with secret key or hardware signer |

### Error handling

LumenFlow contract errors are typed and documented in `docs/errors.md`. Each error
code maps to a human-readable message that the UI and SDK surface to the end user.

UI pages follow these conventions:
- Use `.textContent` (not `.innerHTML`) when echoing user-provided data to prevent XSS.
- Show a generic "not found" message rather than distinguishing "does not exist" from
  "unauthorized" to prevent enumeration.
- Never display payer addresses, memos, or raw signature bytes on public pages.

### Event-driven integrations

All state changes emit events via `lumenflow/*` topics on Stellar. Merchants can
subscribe to their own payment events via Horizon SSE without querying the contract.
See `docs/events-reference.md` and `docs/webhook-integration.md` for full details.

---

## 6. Action-to-contract Mapping Summary

| User action | Contract method | Auth role |
|---|---|---|
| Pay a merchant | `process_payment_with_signature` | Payer |
| Pay a payment request | `pay_payment_request` | Payer |
| View a receipt | `get_payment_summary` | Public |
| View full payment details | `get_payment_by_id` | Payer / Merchant / Admin |
| Request a refund | `initiate_refund` | Payer / Merchant |
| Approve a refund | `approve_refund` | Merchant / Admin |
| Execute a refund | `execute_refund` | Merchant |
| Register as merchant | `register_merchant` | Self |
| Update merchant profile | `update_merchant` | Merchant |
| View payment history | `get_merchant_payment_history` | Merchant |
| View payer history | `get_payer_payment_history` | Payer |
| View merchant stats | `get_merchant_stats` | Merchant |
| View global stats | `get_global_payment_stats` | Admin |
| Verify a merchant | `verify_merchant` | Admin |
| Deactivate a merchant | `deactivate_merchant` | Admin |
| Initiate multisig payment | `initiate_multisig_payment` | Any |
| Sign multisig payment | `sign_multisig_payment` | Designated signer |
| Execute multisig payment | `execute_multisig_payment` | Payer |
| Pause the contract | `pause_contract` | Admin |
| Manage allowed tokens | `add_allowed_token` / `remove_allowed_token` | Admin |
| Set platform fee | `set_platform_fee` | Admin |
| Archive payment record | `archive_payment_record` | Admin |

---

## References

- [Contract API Reference](../README.md#contract-api)
- [Error Codes](errors.md)
- [Architecture](ARCHITECTURE.md)
- [Events Reference](events-reference.md)
- [Webhook Integration](webhook-integration.md)
- [Merchant Payout Reporting](merchant-payout-reporting.md)
- [Multisig Guide](multisig-guide.md)
- [Refund Lifecycle](refund-lifecycle.md)
- [Developer Onboarding](ONBOARDING.md)
