# Security Regression Catalogue

Every security issue that has been fixed in LumenFlow must keep a **dedicated
regression test** so the vulnerability cannot silently return through a refactor,
a merge, or a dependency bump.

This document is the human-readable index. The machine-checkable gate is
[`scripts/security-regression-check.sh`](../../scripts/security-regression-check.sh),
which asserts that every "covered" entry below still has its guard test in the
source tree (matched by a stable marker string). Wire that script into CI so
deleting or renaming a regression test breaks the build.

```bash
./scripts/security-regression-check.sh          # verify covered guards
./scripts/security-regression-check.sh --list    # print the catalogue
./scripts/security-regression-check.sh --strict  # also fail on open gaps
```

Related: [SECURITY.md](../../SECURITY.md) ·
[Threat model — refund flows](../audit/threat-model-refund-flows.md) ·
[Audit report](../audit/audit-report-v1.0.md) ·
[Errors reference](../errors.md)

---

## How to add an entry

1. Land the fix with a regression test whose name (or a section comment)
   contains a **stable, greppable marker**.
2. Add a row to the catalogue table below **and** to the `CATALOGUE` block in
   `scripts/security-regression-check.sh`, using the same marker.
3. Run `./scripts/security-regression-check.sh` — it must print `OK` for the new
   ID.
4. If the fix shipped without a test, add the row with status **gap** and open a
   follow-up issue. `--strict` mode fails on gaps; use it once the backlog is
   clear.

Marker guidance: prefer the exact `fn test_...` name for a single test, or the
section banner comment (e.g. `// ── Refund auth security tests (#45) ──`) for a
cluster.

---

## Catalogue

| ID | Vulnerability class | Origin | Fix summary | Guard test | Marker | Status |
|----|---------------------|--------|-------------|------------|--------|--------|
| VDR-001 | Signature replay | #563 / #351 | Per-merchant sequential nonce included in the signed payload; counter incremented on every successful payment. | `contracts/lumenflow/tests/replay_protection.rs` | `test_nonce_replay_rejected` | ✅ covered |
| VDR-002 | Payment replay (duplicate `order_id`) | #351 | `order_id` uniqueness enforced; a re-submission with a different amount is still rejected as a replay. | `contracts/lumenflow/tests/replay_protection.rs` | `test_signature_payment_replay_different_amount_rejected` | ✅ covered |
| VDR-003 | Signature reuse via non-canonical encoding | #626 | Length-prefixed canonical signature payload so `(A,B)` and `(AB,"")` can no longer produce the same digest; cross-payload replay blocked. | `contracts/lumenflow/src/test.rs` | `Canonical signature payload tests (Issue #626)` | ✅ covered |
| VDR-004 | Privilege-boundary bypass | #347 | Admin self-transfer rejected (`InvalidAdminAddress`); transfer to the zero / current admin blocked. | `contracts/lumenflow/tests/admin_transfer.rs` | `Closes issue #347` | ✅ covered |
| VDR-005 | Refund authorization bypass | #45 | Payer cannot approve/reject their own refund request; only the merchant or admin can. | `contracts/lumenflow/src/test.rs` | `test_payer_cannot_approve_own_refund` | ✅ covered |
| VDR-006 | Integer overflow | #34 | `saturating_add` on cumulative global volume; a payment that would overflow saturates instead of wrapping. | `contracts/lumenflow/src/test.rs` | `test_total_volume_no_overflow_saturates` | ✅ covered |
| VDR-007 | Malformed amount acceptance | #616 | Property test: every non-positive and `i128::MIN` amount is rejected. | `contracts/lumenflow/src/prop_tests.rs` | `prop_non_positive_amount_always_rejected` | ✅ covered |
| VDR-008 | Payment replay invariant (fuzz) | #616 | Property test: a duplicate `order_id` is always rejected regardless of other inputs. | `contracts/lumenflow/src/prop_tests.rs` | `prop_duplicate_order_id_always_rejected` | ✅ covered |
| VDR-009 | Refund over-withdrawal | #616 | Property test: cumulative refunds can never exceed the original payment amount. | `contracts/lumenflow/src/prop_tests.rs` | `prop_refund_cannot_exceed_original` | ✅ covered |
| VDR-010 | Error-code drift | #615 | Regression coverage pins each `PaymentError` variant to its numeric code and trigger path (guards against auth checks silently changing outcome). | `contracts/lumenflow/src/test_error_codes.rs` | `test_error_unauthorized_is_triggered` | ✅ covered |
| VDR-011 | Unbounded iteration / gas DoS | #287 | `cleanup_expired_payments` bounded and gas-safe; large backlogs cannot brick the contract. | `contracts/lumenflow/src/test.rs` | `cleanup_expired_payments safety and gas tests` | ✅ covered |
| VDR-012 | String length boundary | #622 | Explicit boundary tests for max-length business name / description / memo inputs. | `contracts/lumenflow/src/test.rs` | `String length boundary tests` | ✅ covered |
| VDR-013 | Refund auth matrix | #45 | Full authorization matrix for the refund lifecycle (initiate / approve / reject / execute) by role. | `contracts/lumenflow/src/test.rs` | `Refund auth security tests` | ✅ covered |
| VDR-014 | Rate-limit bypass | #565 | Per-merchant rolling-window rate limit (`RateLimitExceeded`, error 90) on `process_payment_with_signature` and `batch_payment`. **No dedicated regression test yet.** | `contracts/lumenflow/src/test.rs` | `RateLimitExceeded` | ⚠️ gap — see [#565 follow-up](#open-gaps) |

---

## Open gaps

| ID | What is missing | Suggested test |
|----|-----------------|----------------|
| VDR-014 | A test that drives a single merchant past the configured window cap and asserts `RateLimitExceeded` (90), then asserts the counter resets after the window advances, and that a *different* merchant in the same window is unaffected. | Add `test_rate_limit_exceeded_then_resets` to `contracts/lumenflow/src/test.rs` (marker must stay `RateLimitExceeded`). |

`scripts/security-regression-check.sh` currently reports `RESULT: PASS` because
gaps are informational by default. Run it with `--strict` in a dedicated CI
step once VDR-014 is closed to keep the catalogue gap-free from then on.

---

## CI integration

Add to the contract test workflow:

```yaml
- name: Security regression coverage gate
  run: ./scripts/security-regression-check.sh
```

The gate is intentionally cheap (no build, just `grep`) so it can run on every
PR. It fails (exit 1) the moment a covered guard test is deleted or renamed
without updating this catalogue.
