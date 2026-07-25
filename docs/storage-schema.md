# Storage Schema Reference

This document describes the on-chain storage layout used by the LumenFlow contract. It is intended for developers writing migration scripts, off-chain indexers, or tooling that reads contract state directly.

The storage keys are defined in the `DataKey` enum in [`contracts/lumenflow/src/storage.rs`](../contracts/lumenflow/src/storage.rs).

---

## Key Layout

| Key Variant | Storage Type | Value Type | TTL Policy | Notes |
|---|---|---|---|---|
| `Admin` | Instance | `Address` | Lives with contract instance | Set once; immutable after `set_admin` |
| `CleanupPeriod` | Instance | `u64` (seconds) | Lives with contract instance | Defaults to 2592000 (30 days) |
| `GlobalStats` | Instance | `GlobalStats` | Lives with contract instance | Saturating counters; never removed |
| `LargePaymentThreshold` | Instance | `i128` | Lives with contract instance | Defaults to 10,000,000 units |
| `MaxRefundsPerOrder` | Instance | `u32` | Lives with contract instance | Defaults to 5 |
| `MerchantList` | Instance | `Vec<Address>` | Lives with contract instance | Append-only list of all registered merchants |
| `Merchant(Address)` | Persistent | `Merchant` | No explicit TTL; persists until removed | One entry per registered merchant address |
| `Payment(String)` | Persistent | `PaymentOrder` | Removed by `archive_payment_record` or `cleanup_expired_payments` | Keyed by `order_id` |
| `MerchantPayments(Address)` | Persistent | `Vec<String>` | Updated on archive/cleanup | List of `order_id` values for a merchant |
| `PayerPayments(Address)` | Persistent | `Vec<String>` | Updated on archive/cleanup | List of `order_id` values for a payer |
| `Refund(String)` | Persistent | `RefundRecord` | No explicit TTL | Keyed by `refund_id` |
| `OrderRefundCount(String)` | Persistent | `u32` | No explicit TTL | Keyed by `order_id`; enforces `MaxRefundsPerOrder` |
| `Multisig(String)` | Persistent | `MultisigPayment` | No explicit TTL | Keyed by `payment_id` |
| `PaymentRequest(String)` | Temporary | `PaymentRequest` | Expires with ledger TTL | Keyed by `request_id`; auto-expires |
| `AllowedToken(Address)` | Instance | `()` (presence flag) | Lives with contract instance | Presence = allowed; absence = not allowed |
| `SubscriptionPlan(String)` | Persistent | `SubscriptionPlan` | TTL extended to 2 years on every write | Keyed by `plan_id`; created by admin |
| `Subscription(String)` | Persistent | `Subscription` | TTL extended to 2 years on every write | Keyed by `subscription_id`; one entry per subscription |
| `SubscriptionReserve(Address, Address)` | Persistent | `i128` | TTL extended to 2 years on every write | Keyed by (subscriber, token); removed when it drops to zero |

---

## XDR Encoding

Soroban serialises `#[contracttype]` enum variants as XDR `ScVal`. Each `DataKey` variant is encoded as an `ScVec` whose first element is the discriminant symbol and whose remaining elements are the variant's fields.

| Key Variant | XDR Representation |
|---|---|
| `Admin` | `ScVec[ScSymbol("Admin")]` |
| `CleanupPeriod` | `ScVec[ScSymbol("CleanupPeriod")]` |
| `GlobalStats` | `ScVec[ScSymbol("GlobalStats")]` |
| `LargePaymentThreshold` | `ScVec[ScSymbol("LargePaymentThreshold")]` |
| `MaxRefundsPerOrder` | `ScVec[ScSymbol("MaxRefundsPerOrder")]` |
| `MerchantList` | `ScVec[ScSymbol("MerchantList")]` |
| `Merchant(addr)` | `ScVec[ScSymbol("Merchant"), ScAddress(addr)]` |
| `Payment(order_id)` | `ScVec[ScSymbol("Payment"), ScString(order_id)]` |
| `MerchantPayments(addr)` | `ScVec[ScSymbol("MerchantPayments"), ScAddress(addr)]` |
| `PayerPayments(addr)` | `ScVec[ScSymbol("PayerPayments"), ScAddress(addr)]` |
| `Refund(refund_id)` | `ScVec[ScSymbol("Refund"), ScString(refund_id)]` |
| `OrderRefundCount(order_id)` | `ScVec[ScSymbol("OrderRefundCount"), ScString(order_id)]` |
| `Multisig(payment_id)` | `ScVec[ScSymbol("Multisig"), ScString(payment_id)]` |
| `PaymentRequest(request_id)` | `ScVec[ScSymbol("PaymentRequest"), ScString(request_id)]` |
| `AllowedToken(addr)` | `ScVec[ScSymbol("AllowedToken"), ScAddress(addr)]` |
| `SubscriptionPlan(plan_id)` | `ScVec[ScSymbol("SubscriptionPlan"), ScString(plan_id)]` |
| `Subscription(subscription_id)` | `ScVec[ScSymbol("Subscription"), ScString(subscription_id)]` |
| `SubscriptionReserve(subscriber, token)` | `ScVec[ScSymbol("SubscriptionReserve"), ScAddress(subscriber), ScAddress(token)]` |

To read a key with the Stellar CLI:

```bash
stellar contract read \
  --id <CONTRACT_ID> \
  --key '{"vec":[{"symbol":"Payment"},{"string":"ORDER_001"}]}' \
  --network testnet
```

---

## Unbounded Growth Keys

The following keys grow with usage and have no automatic pruning:

| Key | Growth Driver | Mitigation |
|---|---|---|
| `Payment(String)` | One entry per payment order | `cleanup_expired_payments` (admin) and `archive_payment_record` (admin) remove stale entries |
| `MerchantPayments(Address)` | One `order_id` appended per payment | Entries are removed in sync with `Payment` cleanup/archive |
| `PayerPayments(Address)` | One `order_id` appended per payment | Entries are removed in sync with `Payment` cleanup/archive |
| `Refund(String)` | One entry per refund request | No automatic pruning; manual cleanup not yet implemented |
| `OrderRefundCount(String)` | One entry per order that has refunds | Bounded per order by `MaxRefundsPerOrder`; not pruned after order removal |
| `Multisig(String)` | One entry per multisig payment | No automatic pruning |
| `MerchantList` | One address appended per registration | Append-only; deactivation does not remove from list |
| `SubscriptionPlan(String)` | One entry per plan created | No automatic pruning |
| `Subscription(String)` | One entry per subscription | No automatic pruning; cancelled/completed records are kept for history |
| `SubscriptionReserve(Address, Address)` | One entry per (subscriber, token) with active subscriptions | Removed automatically when the reserve reaches zero |

Operators running off-chain indexers should monitor ledger entry counts for the persistent keys above and schedule admin cleanup calls as needed..

---

## Subscription Records

Value types stored under the subscription keys (defined in `contracts/lumenflow/src/types.rs`):

`SubscriptionPlan` (key: `SubscriptionPlan(plan_id)`):

| Field | Type | Notes |
|---|---|---|
| `plan_id` | `String` | Unique plan identifier (max 64 chars) |
| `token` | `Address` | Token contract used for every charge; must be on the allow-list at creation |
| `amount` | `i128` | Positive amount charged per billing cycle |
| `interval_secs` | `u64` | Seconds required between charges; non-zero |
| `max_cycles` | `u32` | Maximum number of charges; non-zero |
| `created_at` | `u64` | Ledger timestamp at creation |

`Subscription` (key: `Subscription(subscription_id)`):

| Field | Type | Notes |
|---|---|---|
| `subscription_id` | `String` | Unique subscription identifier (max 64 chars) |
| `plan_id` | `String` | References the `SubscriptionPlan` key |
| `merchant` | `Address` | Receives each charge; only address allowed to call `charge_subscription` |
| `subscriber` | `Address` | Charged each cycle; authorised the subscription |
| `status` | `SubscriptionStatus` | `Active`, `Cancelled`, or `Completed` |
| `cycles_charged` | `u32` | Number of successful charges so far |
| `last_charged_at` | `u64` | Interval anchor: subscribe time until the first charge, then the last charge time |
| `created_at` | `u64` | Ledger timestamp at subscribe time |

Lifecycle: `subscribe` writes an `Active` record with `cycles_charged = 0`, adds `amount * max_cycles` to the subscriber's `SubscriptionReserve` for the plan's token, and approves the contract for the full reserve. SEP-41 `approve` sets (not adds to) the per-(from, spender) allowance, so the reserve tracks the combined remaining cycles of all of the subscriber's active subscriptions in that token and every `subscribe` re-approves that total. `charge_subscription` requires `now >= last_charged_at + interval_secs` and `cycles_charged < max_cycles`, and re-checks at charge time that the plan token is still on the allow-list and the merchant is still active, so admin deactivation or token delisting also stops recurring charges. A successful charge draws the plan amount from the allowance via `transfer_from`, decrements the reserve, increments `cycles_charged`, resets `last_charged_at`, and sets status to `Completed` when `max_cycles` is reached, at which point that subscription's share of the allowance has been fully consumed. `cancel_subscription` (merchant or subscriber) sets status to `Cancelled` and releases the uncharged cycles from the reserve; a subscriber-initiated cancel also re-approves the allowance down to the new reserve, while a merchant-initiated cancel cannot (approve needs the subscriber's auth) and leaves a residual allowance the subscriber can clear with `renew_subscription_allowance`. Cancelled and completed subscriptions can never be charged again. The allowance itself lives on the token contract, not in this contract's storage, and its expiry is capped by the network's maximum entry TTL, which can be shorter than a long subscription's lifetime; `renew_subscription_allowance` re-approves the current reserve with a fresh expiry whenever needed.
