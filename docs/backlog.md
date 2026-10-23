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
