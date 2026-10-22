# ADR-002 — Cursor-Based Pagination for Payment History Queries

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-01-20 |
| **Deciders** | @Gloriachinedu |
| **Tags** | api / performance / storage |

---

## Context

`get_merchant_payment_history` and `get_payer_payment_history` need to return a subset of a potentially large list of payment records stored in `MerchantPayments(Address)` and `PayerPayments(Address)`.

Two pagination styles were evaluated:

1. **Offset-based**: caller provides `offset` (integer) and `limit`. The contract skips the first `offset` records and returns the next `limit`.
2. **Cursor-based**: caller provides an `order_id` string (or `null` for the first page) and a `limit`. The contract returns records after the given cursor.

Soroban contracts pay for every byte of storage they read in a single invocation. Reading the full payment ID index (`Vec<String>`) for a merchant with thousands of payments on every paginated query is expensive in CPU instructions and memory.

Additionally, offset-based pagination is **unstable under concurrent writes**: if a payment is inserted at index 3 while a caller is iterating, the caller will skip a record or see a duplicate on the next page. This is particularly problematic for payer histories that can grow while the caller is paginating.

---

## Decision

We will use **cursor-based pagination** using `order_id` as the cursor key.

- The first page is requested with `cursor: null`.
- Subsequent pages pass the `next_cursor` value from the previous response.
- The contract locates the cursor position in the index Vec and slices from that point.
- The response includes `next_cursor: Option<String>` (null when the last page is reached) and `total: u32` (total records in the index at query time).

Maximum page size is capped at **100 records** regardless of the `limit` parameter.

---

## Consequences

### Positive
- Stable results under concurrent inserts: new payments appended after the cursor do not shift earlier records.
- Callers can resume interrupted pagination without duplicating or skipping records.
- Compatible with Horizon-style event streaming patterns that frontend teams are already familiar with.

### Negative / Trade-offs
- Callers cannot jump to an arbitrary page (e.g. "page 5 of 20") without walking through previous pages.
- The `total` count can become stale between pages if records are cleaned up mid-pagination.
- Locating the cursor in the Vec is O(n) in the current implementation; acceptable for typical list sizes.

### Neutral
- The cursor format is opaque to callers — it happens to be an `order_id` string, but callers should treat it as an opaque token and not parse it.

---

## Alternatives Considered

| Alternative | Reason not chosen |
|-------------|------------------|
| Offset-based pagination | Unstable under concurrent writes; produces duplicate or skipped results |
| Keyset pagination with timestamp | Timestamps are not unique (two payments can share a ledger timestamp); would require tie-breaking |
| Return all records (no pagination) | Unbounded storage read; hits Soroban instruction limits for large histories |

---

## References

- `contracts/lumenflow/src/lib.rs` — `get_merchant_payment_history`, `get_payer_payment_history`
- `contracts/lumenflow/src/types.rs` — `PaymentPage` struct (`payments`, `next_cursor`, `total`)
- [Stellar Soroban resource limits](https://developers.stellar.org/docs/smart-contracts/resource-limits-fees)
