# Product Backlog

This document tracks planned features and proposals for future development.

## Recurring Billing / Subscription Payment Support

**Issue:** #363  
**Priority:** Low  
**Estimated Effort:** Large  
**Dependencies:** Product planning  
**Labels:** product, feature, planning

### Proposal

Define a recurring payment workflow that allows payers to authorize periodic token transfers to merchants on a predefined schedule.

### Data Model

- `SubscriptionRecord` — stores subscription ID, payer, merchant, token, amount, interval (seconds), next\_due\_at, status (Active / Paused / Cancelled), and created\_at timestamp.
- `SubscriptionId` — unique string identifier per subscription.

### Contract Behaviours

- Subscriptions are created by the payer and require merchant acceptance.
- Charges are triggered on or after `next_due_at`; the contract advances `next_due_at` by the interval on each successful charge.
- Payer or merchant may pause or cancel at any time.
- Failed charges (insufficient balance, token not allowed) leave the subscription in a `PastDue` state.
- Admin may cancel any subscription.

### Required New Entrypoints

| Entrypoint | Caller | Description |
|---|---|---|
| `create_subscription` | Payer | Create a new recurring billing agreement |
| `accept_subscription` | Merchant | Merchant confirms acceptance |
| `charge_subscription` | Anyone | Trigger a due charge (permissionless) |
| `pause_subscription` | Payer / Merchant | Pause future charges |
| `resume_subscription` | Payer / Merchant | Resume a paused subscription |
| `cancel_subscription` | Payer / Merchant / Admin | Cancel and deactivate |
| `get_subscription` | Any | Retrieve subscription details |
| `list_merchant_subscriptions` | Merchant / Admin | Paginated list for a merchant |
| `list_payer_subscriptions` | Payer | Paginated list for a payer |

### Backlog Status

Pending product planning sign-off before implementation begins.

---

## Subscription Cancellation Grace Period and Proration Logic

**Issue:** #1610
**Priority:** Low
**Estimated Effort:** Medium
**Dependencies:** Subscription payment implementation
**Labels:** feature, product, smart-contract

### Design

When a subscriber cancels mid-cycle, the merchant's configured `ProrationPolicy` determines the outcome:

| Policy | Behaviour |
|--------|-----------|
| `NoRefund` (default) | No refund; subscriber retains access for the remainder of the paid cycle. |
| `Prorate` | Unused cycle fraction refunded: `plan_amount × (remaining_secs / interval_secs)`. Requires subscriber to pass `request_proration = true`. |
| `GracePeriod(secs)` | No refund; no further charges for `secs` seconds post-cancellation. |

### Contract Entrypoints

| Entrypoint | Caller | Description |
|---|---|---|
| `set_proration_policy(merchant, policy)` | Merchant | Configure the cancellation policy for their subscriptions |
| `get_proration_policy(merchant)` | Any | Read the current policy |
| `cancel_subscription(caller, id, request_proration)` | Payer / Merchant | Cancel with optional proration claim |

### Status

Implemented — see [ADR-009](adr/ADR-009-subscription-cancellation-proration.md).
