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

Operators running off-chain indexers should monitor ledger entry counts for the persistent keys above and schedule admin cleanup calls as needed..
