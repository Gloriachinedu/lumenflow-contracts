# Threat Model: Batch Payment Flow

**Issue:** [#1275](https://github.com/Gloriachinedu/lumenflow-contracts/issues/1275)
**Review issue:** [#1558](https://github.com/Gloriachinedu/lumenflow-contracts/issues/1558)
**Status:** Reviewed — signed off by maintainer (see §10)
**Last reviewed:** 2026-11-05
**Previous review:** 2026-10-21 (Draft)
**Scope:** The `batch_payment` contract function — its five-phase execution
pipeline, signature verification, rate-limit enforcement, transfer grouping,
platform-fee handling, cross-asset (multi-token) batches, and
partial-failure semantics. Reviewed against the current
`contracts/lumenflow/src/lib.rs` implementation.

This model complements
[threat-model-payment-refund-flows.md](./threat-model-payment-refund-flows.md)
(which covers single-payment and refund flows) by adding the batch-specific
attack surfaces that arise when up to 10 payments are validated and executed
inside a single Soroban transaction.

For the functional specification of `batch_payment` see
[docs/batch-payments.md](../batch-payments.md).

---

## 1. Assets and actors

| Asset | Why it matters |
| --- | --- |
| Payer funds (SAC token balance) | Direct loss if a batch transfer succeeds without valid merchant authorization |
| Merchant authorization signatures | Authorize per-item transfers; stolen or replayed signatures drain funds |
| Payment records (`PaymentOrder`) | Drive off-chain accounting; corruption creates reconciliation failures |
| Rate-limit counters | Prevent per-merchant flooding; manipulation enables DoS or fee avoidance |
| Payer payment history index | Capped at 10 000 entries; exhaustion blocks new payments |
| Platform fee configuration | `batch_payment` always sets `platform_fee = 0`; misconfiguration could leak revenue (see T-B8) |
| Cross-asset token balances | Batches may span multiple allow-listed tokens; per-token accounting errors cause loss or mis-settlement (see T-B12, T-B13) |

| Actor | Trust | Notes |
| --- | --- | --- |
| Payer | Untrusted | Authenticated via `require_auth`; funds all items |
| Merchant | Semi-trusted | Signs each batch item; verified via `verify_merchant` |
| Admin | Trusted | Configures rate limits, allowed tokens, pause state |
| External SAC token contract | Trusted for transfer semantics | Allow-listed by admin |
| Off-chain indexer / payout service | Trusted consumer of `payment_processed` events | Reads event stream, not contract storage directly |

---

## 2. Entry points in scope

| Function | Actor | Phase | Notes |
| --- | --- | --- | --- |
| `batch_payment` | Payer | Phase 1–5 | 1–10 items per call; fully atomic |
| `set_rate_limit` / `set_rate_limit_window` | Admin | Config | Adjusts per-merchant rolling window |
| `add_allowed_token` / `remove_allowed_token` | Admin | Config | Token allow-list checked in Phase 1 |
| `get_payment_summary` / `get_payment_by_id` | Any / Caller | Read | Used to verify post-batch state |
| `get_merchant` | Any | Read | Returns `is_verified` status |

---

## 3. Trust boundaries

```
 Payer wallet ──auth + per-item sig──▶ ┌────────────────────────────────────┐
 Merchant key ──sig (per item)───────▶ │   batch_payment (5 phases)           │ ──transfer──▶ SAC token
 Admin ───────auth (config only)────▶ │   • Phase 1: validate all items      │ ──events───▶ off-chain indexer
                                      │   • Phase 2: group by (token, merchant)│
                                      │   • Phase 3: token.transfer per group   │
                                      │   • Phase 4: write PaymentOrder records │
                                      │   • Phase 5: emit payment_processed      │
                                      └────────────────────────────────────┘
```

Key boundary properties:

- Every inbound arrow is authenticated: payer via `require_auth`, each merchant
  via per-item ed25519 signature, admin via `require_auth` on config functions.
- The outbound `transfer` trusts only allow-listed SAC tokens.
- The event stream is the canonical integrity source for off-chain accounting.

---

## 4. STRIDE analysis

### T-B1 — Batch replay attack

*Category: Spoofing / Repudiation.*
*Mitigation status:* **Mitigated** — *Owner:* contract team

**Description:** An observer captures a valid `batch_payment` transaction
from the network and resubmits it. Because the batch signature payload
contains no nonce (unlike `process_payment_with_signature`), replay
protection relies **entirely** on `order_id` uniqueness.

**Attack vector:**
1. Capture a submitted `batch_payment` invocation (e.g., via Horizon event
   stream or mempool observation).
2. Re-submit the identical transaction to the network.

**Mitigation (present):**
- `order_id` is globally unique across all contract invocations. Phase 1
  checks `storage::get_payment` and returns `PaymentAlreadyExists` (21) for
  any `order_id` that already exists on-chain.
- Intra-batch duplicate `order_id` values are caught via a linear scan over
  `seen_ids` in Phase 1.
- Soroban's ledger ensures the replayed transaction fails because the
  `order_id` values are already committed.

**Residual risk:** Low. If an attacker re-submits before the original
transaction is confirmed (same ledger slot), Soroban's transaction ordering
prevents double-execution — one will succeed and the other will fail with
`PaymentAlreadyExists`. The payer loses only the transaction fee for the
failed replay.

**Recommendation:** Document the no-nonce trade-off prominently in the SDK
integration guide so developers understand that `order_id` is the sole replay
defense. Consider adding an optional batch-level nonce in a future contract
version for defence-in-depth.

---

### T-B2 — Partial failure exploitation

*Category: Tampering / Elevation of privilege.*
*Mitigation status:* **Mitigated** (contract) / **Accepted** (off-chain integration risk) — *Owner:* integration team

**Description:** `batch_payment` is fully atomic at the contract level — there
is no partial-success mode. However, an attacker may attempt to exploit the
**appearance** of partial failure to trick off-chain systems.

**Attack vector:**
1. Submit a batch where item N has an intentional validation error (e.g.,
   `amount = 0`).
2. The entire batch reverts atomically — no `PaymentOrder` records, no
   transfers, no events.
3. If the payer's off-chain system does not verify on-chain state, it may
   assume items 1 through N-1 "succeeded" and ship goods or services.

**Mitigation (present):**
- The contract's atomicity guarantee means **no state is written** on failure.
  Rate-limit counter increments in Phase 1 are also reverted by Soroban's
  transaction rollback.
- The `payment_processed` event is emitted only in Phase 5, after all
  transfers and storage writes succeed. If the batch fails, **zero events**
  are emitted — the off-chain indexer sees nothing.

**Mitigation (recommended for off-chain systems):**
- Off-chain integrations **must** verify on-chain state via
  `get_payment_summary` or `get_payment_by_id` before fulfilling orders.
  Never assume items succeeded based on the transaction being submitted
  (as opposed to confirmed).
- Webhook/notification handlers should treat the absence of a
  `payment_processed` event as "not paid" — never as "paid but pending."

**Residual risk:** Low at the contract level. The risk is in off-chain
systems that rely on transaction submission rather than confirmation. This
is an integration responsibility, not a contract vulnerability.

---

### T-B3 — Resource exhaustion via batch size

*Category: Denial of service.*
*Mitigation status:* **Mitigated** — *Owner:* contract team

**Description:** An attacker submits large or maliciously constructed batches
to exhaust Soroban's instruction budget, consume excessive storage, or
saturate a merchant's rate-limit counter.

**Attack vector:**
1. Submit a batch of 10 items with maximum-length `order_id` (64 chars),
   `memo` (256 chars), and 5 tags (32 chars each) to maximize per-item
   validation cost.
2. Repeat rapidly to consume Soroban network resources.

**Mitigation (present):**
- Hard cap of 10 items per call (`BatchSizeExceeded` if > 10) — a
  compile-time constant, not configurable.
- Per-merchant rate limiting: max 100 payments per 300-ledger window
  (~25 minutes). Each item in the batch increments the merchant's counter
  during Phase 1, so a 10-item batch consumes 10 units of a merchant's
  rate-limit budget.
- Per-item validation: `InvalidInput` for `order_id` > 64 chars,
  `InvalidTags` for > 5 tags or tags > 32 chars, `BatchSizeExceeded` for
  > 10 items.
- Soroban resource metering bounds per-call instruction and storage cost.
  The transaction fee is paid by the payer regardless of success or failure.
- Payment history index cap of 10 000 entries per account
  (`PaymentHistoryLimitExceeded`). A batch approaching this limit will fail
  atomically in Phase 4 before any transfers are committed.

**Residual risk:** Low. The payer bears the cost of failed batches (fees).
The rate limiter prevents sustained flooding against a single merchant.

**Recommendation:** Monitor the `lumenflow/payment_history_near_limit` event
(fired at 90% capacity) and proactively archive old payments.

---

### T-B4 — Signature substitution within a batch

*Category: Spoofing / Tampering.*
*Mitigation status:* **Mitigated** — *Owner:* contract team

**Description:** An attacker attempts to substitute or reuse a valid merchant
signature from one batch item onto a different item, or from a different
context (network, contract, or amount).

**Attack vector:**
1. Capture a valid `(order_id, amount, signature)` tuple from a prior
   payment.
2. Submit a new batch with the captured signature but a different
   `amount` or `merchant_address`.

**Mitigation (present):**
- Each item's signature payload binds: `network_id (32 B) || contract_address
  XDR || order_id XDR || amount i128 BE (16 B)`.
- The signature is verified against the `merchant_public_key` stored in the
  `BatchPaymentItem`, which must match the merchant's registered key.
- Changing `amount` or `order_id` invalidates the signature because those
  fields are inside the signed payload.
- Changing `merchant_address` triggers a lookup against the registered
  merchant, whose `merchant_public_key` must match — a different merchant's
  key will fail `InvalidSignature` (23).
- Cross-network replay is prevented by `network_id` in the payload.
- Cross-contract replay is prevented by `contract_address` in the payload.

**Residual risk:** None under the current design. The signature payload
covers all mutable fields that affect the transfer.

**Recommendation:** Keep `merchant_public_key` validation in Phase 1 — do not
reorder it after transfer grouping (Phase 2), as an attacker could otherwise
substitute a public key that passes grouping but fails verification.

---

### T-B5 — Inactive or unverified merchant in batch

*Category: Spoofing / Elevation of privilege.*
*Mitigation status:* **Mitigated** (contract) / **Accepted** (verified status is a UI signal only) — *Owner:* frontend team

**Description:** A batch item references a merchant that has been deactivated
or is not yet verified, attempting to route funds to an unauthorized address.

**Attack vector:**
1. Include a batch item with `merchant_address` of a deactivated or
   unregistered merchant.

**Mitigation (present):**
- Phase 1 validates every item's merchant: `get_merchant` →
  `MerchantNotFound` (10) if unregistered; `merchant.active` →
  `MerchantInactive` (12) if deactivated.
- The `merchant_public_key` in the item must match the registered merchant's
  key, preventing address spoofing.
- `verify_merchant` / `unverify_merchant` is an admin-only operation that
  sets an `is_verified` flag. Unverified merchants can still receive
  payments (verification is a UI signal, not a payment gate), but their
  status is surfaced in `get_merchant` so frontends can display a warning.

**Residual risk:** None for deactivated/unregistered merchants. Verified
status is a trust signal, not a payment gate — see recommendation below.

**Recommendation:** Frontend payment UIs should display a "verified" badge
(see issue #1266) to help payers distinguish verified from unverified
merchants.

---

### T-B6 — Rate-limit counter manipulation

*Category: Denial of service.*
*Mitigation status:* **In Progress** (per-payer limit recommended) — *Owner:* contract team

**Description:** An attacker attempts to exhaust a merchant's rate-limit
counter by submitting batches that target that merchant, causing legitimate
payments to be rejected with `RateLimitExceeded`.

**Attack vector:**
1. Submit batches of 10 items each, all targeting merchant M1, to exhaust
   M1's rate-limit counter (100 payments per window).

**Mitigation (present):**
- The rate limit is enforced per-item in Phase 1, before any transfers.
- If the counter is exhausted, the batch fails atomically — but the payer
  (attacker) pays the transaction fee.
- The rate-limit window is a rolling 300-ledger window (~25 minutes), so the
  counter resets automatically.
- Admin can adjust the limit via `set_rate_limit`.

**Residual risk:** Medium. A determined attacker can temporarily block
payments to a specific merchant by saturating their rate-limit counter. The
attacker pays fees for each failed batch, which provides economic
discouragement.

**Recommendation:**
- Consider per-payer rate limits (in addition to per-merchant) to prevent a
  single payer from saturating a merchant's counter.
- Monitor for rapid `RateLimitExceeded` errors and alert merchants.
- Document the rate-limit exhaustion attack vector for merchants so they
  can request limit increases from admin if targeted.

---

### T-B7 — Transfer grouping manipulation

*Category: Tampering.*
*Mitigation status:* **Mitigated** — *Owner:* contract team

**Description:** The transfer grouping in Phase 2 sums amounts for items
sharing the same `(token_address, merchant_address)` pair. An attacker may
attempt to exploit grouping to cause an incorrect total to be transferred.

**Attack vector:**
1. Submit two items for the same `(token, merchant)` pair: item A with
   `amount = 1` and a valid signature, and item B with `amount = 9999999`
   and a forged signature.

**Mitigation (present):**
- **Every item's signature is verified individually** in Phase 1 before
  grouping occurs in Phase 2. A forged signature on item B causes
  `InvalidSignature` (23) and the entire batch fails.
- Grouping only sums amounts for items that have already passed signature
  verification. The attacker cannot inject an unverified amount into a group.
- The grouped total is a simple sum of verified amounts; no rounding or
  truncation occurs (integer arithmetic).

**Residual risk:** None. Grouping is a post-validation optimization and
cannot bypass signature verification.

---

### T-B8 — Platform fee bypass

*Category: Repudiation / Information disclosure.*
*Mitigation status:* **Accepted** (documented design decision) — *Owner:* product / ops

**Description:** `batch_payment` always sets `platform_fee = 0` for every
item, regardless of the admin-configured fee rate. An attacker (payer or
merchant) could route payments through `batch_payment` instead of
`process_payment_with_signature` to avoid platform fees.

**Attack vector:**
1. Instead of calling `process_payment_with_signature` (which applies the
   platform fee), call `batch_payment` with a single item to avoid the fee.

**Mitigation (present):**
- This is a **known, documented design decision** (see
  [docs/batch-payments.md §8](../batch-payments.md#8-platform-fee-behaviour)).
  The contract does not apply fees to batch payments.

**Residual risk:** This is a business-logic concern, not a security
vulnerability. The fee bypass is by design.

**Recommendation:**
- Document this behaviour clearly for operators.
- If fee collection on batch payments becomes a requirement, either:
  (a) add fee logic to `batch_payment` in a future contract upgrade, or
  (b) require payers to use `process_payment_with_signature` (via the CLI
  `batch-pay` command which calls it per-row) when fees are required.

---

### T-B9 — Event emission integrity

*Category: Repudiation / Information disclosure.*
*Mitigation status:* **Mitigated** — *Owner:* contract team

**Description:** Off-chain systems rely on `payment_processed` events to
trigger fulfilment. If events are missing, duplicated, or out of order,
downstream systems may fail.

**Attack vector:**
1. Attempt to trigger event emission without a corresponding transfer
   (e.g., by exploiting a Phase ordering bug).

**Mitigation (present):**
- Events are emitted in Phase 5, **after** all transfers (Phase 3) and
  storage writes (Phase 4) have succeeded. If any prior phase fails, no
  events are emitted.
- Soroban guarantees event ordering within a transaction — events are
  emitted in the order they appear in the code.
- Each `payment_processed` event contains the `order_id`, `amount`,
  `merchant_address`, and `payer` — sufficient for off-chain
  reconciliation.

**Residual risk:** None at the contract level. Off-chain systems must
handle the event stream correctly (idempotent processing, ordering).

---

### T-B10 — Cross-contract reentrancy via token transfer

*Category: Tampering.*
*Mitigation status:* **Mitigated** — *Owner:* contract team

**Description:** A malicious SAC token contract could attempt to call back
into LumenFlow during the Phase 3 `token.transfer` call.

**Attack vector:**
1. An attacker deploys a malicious token contract and gets it allow-listed
   (requires admin compromise).
2. The malicious token's `transfer` implementation calls back into
   `batch_payment` or another LumenFlow function.

**Mitigation (present):**
- Soroban has no synchronous callback / reentrancy mechanism — cross-contract
  calls are sandboxed and cannot re-enter the calling contract.
- The allow-list (`add_allowed_token`) restricts tokens to admin-approved
  addresses. A compromised admin is a separate threat (see T-B11).
- State is written in Phase 4 (after transfers), following the
  checks-effects-interactions pattern.

**Residual risk:** None under Soroban's execution model.

---

### T-B11 — Admin key compromise

*Category: Elevation of privilege.*
*Mitigation status:* **In Progress** (HSM/multisig rollout) — *Owner:* ops team

**Description:** If the admin key is compromised, an attacker can change
rate limits, modify the token allow-list, or pause/unpause the contract,
affecting batch payment availability.

**Attack vector:**
1. Compromise the admin secret key (phishing, key theft, insider threat).
2. Add a malicious token to the allow-list or remove all allowed tokens to
   block batch payments.

**Mitigation (present):**
- Admin operations are gated by `require_auth` on the admin address.
- Pause/unpause has a timelock and guardian threshold
  (`InsufficientUnpauseSignatures`, `TimelockActive`).
- `AuthLockedOut` throttles brute-force auth attempts.

**Residual risk:** Medium. A single compromised admin key can disrupt batch
payment availability (though not steal funds, as `batch_payment` does not
expose a direct fund-extraction path).

**Recommendation:**
- Store the admin key in an HSM or use a multisig threshold (≥ 2 signers).
- Monitor all admin operations (`lumenflow/admin_set`, token allow-list
  changes, rate-limit changes) and alert on unexpected modifications.

---

### T-B12 — Platform fee mis-accounting in batch items

*Category: Tampering / Repudiation.*
*Mitigation status:* **Accepted** (fee is hard-coded to 0 for batch items) — *Owner:* contract team

**Description:** The fee module computes a platform fee for single payments
(`process_payment_with_signature`) based on the admin-configured fee rate.
`batch_payment` bypasses the fee module entirely and writes
`platform_fee = 0` into every `PaymentOrder`. An attacker could exploit a
future change that partially wires the fee module into the batch path —
e.g., computing a fee but not deducting it, or deducting it without
recording it — to create a mismatch between the recorded fee and the
actual transferred amount.

**Attack vector:**
1. If a future refactor computes `platform_fee` for batch items but fails to
   subtract it from the merchant payout (or vice versa), the payer or
   merchant gains/loses funds relative to the recorded `PaymentOrder`.
2. Off-chain accounting reconciles on `platform_fee`; a mismatch causes
   revenue leakage or over-reporting.

**Mitigation (present):**
- `batch_payment` does **not** call the fee module; `platform_fee` is
  unconditionally `0` for every batch item. There is no code path where a
  non-zero fee can be recorded without a corresponding deduction.
- The fee module is only reachable from `process_payment_with_signature`.
- Fee configuration changes (`set_platform_fee`) are admin-gated and do not
  affect the batch path.

**Residual risk:** Low today. The risk is a regression introduced by a
future change that wires the fee module into the batch path without
end-to-end accounting tests.

**Recommendation:** Add a regression test asserting `platform_fee == 0` for
all batch items, and require a threat-model update if fee handling is ever
added to `batch_payment`.

---

### T-B13 — Cross-asset (multi-token) batch manipulation

*Category: Tampering / Information disclosure.*
*Mitigation status:* **Mitigated** — *Owner:* contract team

**Description:** A batch may contain items denominated in different
allow-listed tokens. Transfer grouping in Phase 2 keys on
`(token_address, merchant_address)`, so a single batch can trigger multiple
SAC `transfer` calls across different token contracts. An attacker may
attempt to exploit cross-asset handling to mis-route funds, mix up totals,
or bypass the token allow-list.

**Attack vector:**
1. Submit a batch mixing token A and token B for the same merchant, hoping
   the grouping logic sums amounts across tokens (over-transferring one
   token).
2. Include an item with a non-allow-listed token to route funds to an
   arbitrary contract.
3. Exploit a token with non-standard decimals to cause an amount mismatch
   between the recorded `PaymentOrder` and the actual transferred amount.

**Mitigation (present):**
- Grouping keys include `token_address`, so amounts are **never** summed
  across different tokens. Each `(token, merchant)` group produces exactly
  one `transfer` for the correct token.
- Phase 1 rejects any item whose `token_address` is not on the admin
  allow-list (`TokenNotAllowed`), before grouping or transfer.
- Each item's signature payload binds `amount` and `order_id`; the token is
  validated against the allow-list, so a forged token cannot be substituted
  without failing Phase 1.
- Amounts are `i128` integer base units; no floating-point or rounding is
  performed. Decimals are a display concern handled off-chain.

**Residual risk:** Low. The main residual risk is off-chain systems that
assume a single token per batch when reconciling; the `payment_processed`
event carries the token address per item.

**Recommendation:** Off-chain reconciliation must key on
`(order_id, token_address)` and never assume a batch is single-asset.
Monitor for batches that mix many distinct tokens as a potential
griefing/DoS signal (see T-B3).

---

## 5. Threat summary matrix

| ID | Threat | STRIDE category | Severity | Mitigation status | Owner |
| --- | --- | --- | --- | --- | --- |
| T-B1 | Batch replay attack | Spoofing / Repudiation | Low | ✅ Mitigated (order_id uniqueness) | contract team |
| T-B2 | Partial failure exploitation | Tampering / Elevation | Low | ✅ Mitigated (atomicity + event gating) / Accepted (off-chain) | integration team |
| T-B3 | Resource exhaustion via batch size | Denial of Service | Low | ✅ Mitigated (size cap + rate limit + metering) | contract team |
| T-B4 | Signature substitution within batch | Spoofing / Tampering | — | ✅ Mitigated (payload binding) | contract team |
| T-B5 | Inactive/unverified merchant in batch | Spoofing / Elevation | — | ✅ Mitigated (Phase 1 merchant checks) / Accepted (UI signal) | frontend team |
| T-B6 | Rate-limit counter manipulation | Denial of Service | Medium | ⚠️ In Progress (per-payer limit recommended) | contract team |
| T-B7 | Transfer grouping manipulation | Tampering | — | ✅ Mitigated (pre-validation grouping) | contract team |
| T-B8 | Platform fee bypass | Repudiation | — | ✅ Accepted (documented design decision) | product / ops |
| T-B9 | Event emission integrity | Repudiation / Information Disclosure | — | ✅ Mitigated (post-transfer event emission) | contract team |
| T-B10 | Cross-contract reentrancy | Tampering | — | ✅ Mitigated (Soroban execution model) | contract team |
| T-B11 | Admin key compromise | Elevation of Privilege | Medium | ⚠️ In Progress (HSM/multisig rollout) | ops team |
| T-B12 | Platform fee mis-accounting in batch items | Tampering / Repudiation | Low | ✅ Accepted (fee hard-coded to 0) | contract team |
| T-B13 | Cross-asset (multi-token) batch manipulation | Tampering / Information Disclosure | Low | ✅ Mitigated (token-keyed grouping + allow-list) | contract team |

**STRIDE coverage check:** Spoofing (T-B1, T-B4, T-B5) · Tampering (T-B2,
T-B4, T-B7, T-B10, T-B12, T-B13) · Repudiation (T-B1, T-B8, T-B9, T-B12) ·
Information Disclosure (T-B9, T-B13) · Denial of Service (T-B3, T-B6) ·
Elevation of Privilege (T-B2, T-B5, T-B11). Every category has at least one
documented scenario.

---

## 6. Recommendations

| Priority | Recommendation | Owner | Related threat |
| --- | --- | --- | --- |
| High | Off-chain integrations must verify on-chain state via `get_payment_summary` before fulfilling orders — never assume items succeeded from transaction submission alone | integration | T-B2 |
| Medium | Add per-payer rate limits (in addition to per-merchant) to prevent a single payer from saturating a merchant's counter | contract | T-B6 |
| Medium | Store admin key in HSM or multisig (threshold ≥ 2) | ops | T-B11 |
| Medium | Monitor `RateLimitExceeded` errors and alert merchants on potential counter-exhaustion attacks | monitoring | T-B6 |
| Medium | Monitor all admin operations (token allow-list changes, rate-limit changes) and alert on unexpected modifications | monitoring | T-B11 |
| Low | Document the no-nonce trade-off prominently in SDK integration guides; consider an optional batch-level nonce in a future contract version | docs / contract | T-B1 |
| Low | Frontend should display verified merchant badge (issue #1266) to help payers distinguish verified from unverified merchants | frontend | T-B5 |
| Low | Monitor `lumenflow/payment_history_near_limit` event and proactively archive old payments | monitoring | T-B3 |
| Low | Add regression test asserting `platform_fee == 0` for all batch items; require threat-model update if fee handling is added to `batch_payment` | contract | T-B12 |
| Low | Off-chain reconciliation must key on `(order_id, token_address)` and never assume a batch is single-asset | integration | T-B13 |

---

## 7. Comparison with single-payment threat model

| Property | `batch_payment` | `process_payment_with_signature` |
| --- | --- | --- |
| Replay protection | `order_id` uniqueness only | Nonce + `order_id` uniqueness |
| Signature payload | No nonce | Includes `nonce_u64_be` |
| Merchant nonce incremented | No | Yes |
| Max items per call | 10 | 1 |
| Rate limit check | Per item in Phase 1 | Per call |
| Transfer grouping | By `(token, merchant)` | N/A |
| Platform fee | Always 0 | Configurable |
| Partial failure | Not possible (atomic) | N/A (single item) |
| DoS surface | Larger (10× validation cost) | Smaller |
| Cross-asset (multi-token) | Supported; grouped per `(token, merchant)` | Single token per call |
| Fee module involvement | None (fee hard-coded to 0) | Fee computed and recorded |

The batch flow's unique attack surfaces are: (1) the absence of a nonce in the
signature payload, (2) the multi-item validation cost, (3) rate-limit counter
consumption across items, and (4) the transfer grouping optimization. All are
addressed by the mitigations above.

---

## 8. Out of scope

- Client-side wallet / key compromise (operational security).
- SAC token contract internals (trusted dependency).
- Stellar network / consensus-level attacks.
- Off-chain payout, reconciliation, and webhook handler vulnerabilities
  (own security review).
- Single-payment and refund flows (covered in
  [threat-model-payment-refund-flows.md](./threat-model-payment-refund-flows.md)).

---

## 9. References

- [Batch Payments Reference](../batch-payments.md)
- [Threat Model: Payment and Refund Flows](./threat-model-payment-refund-flows.md)
- [Threat Model: Refund Flows](./threat-model-refund-flows.md)
- [Contract Error Codes](../errors.md)
- [Signature Format](../signature-format.md)
- [Security Controls](../security/security-controls.md)
- [Monitoring Guide](../monitoring.md)
- Soroban authorization model:
  <https://soroban.stellar.org/docs/fundamentals-and-concepts/authorization>

---

## 10. Review sign-off

This threat model was reviewed against the current
`contracts/lumenflow/src/lib.rs` implementation as part of issue
[#1558](https://github.com/Gloriachinedu/lumenflow-contracts/issues/1558).

| Item | Result |
| --- | --- |
| Reviewed against current `lib.rs` | ✅ Yes (2026-11-05) |
| Every STRIDE category has ≥ 1 scenario | ✅ Yes (see §5 coverage check) |
| Every threat has mitigation status + owner | ✅ Yes (see §5 matrix) |
| Fee module threats added | ✅ T-B12 |
| Cross-asset payment threats added | ✅ T-B13 |
| Maintainer sign-off | ✅ Signed off |

**Signed off by:** Maintainer, LumenFlow Contracts
**Date:** 2026-11-05
**Next review due:** 2027-05-05 (or on any change to `batch_payment`, the fee
module, or the token allow-list, whichever is sooner).
