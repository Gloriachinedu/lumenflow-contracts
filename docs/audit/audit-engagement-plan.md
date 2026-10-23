# Pre-Mainnet Smart-Contract Audit — Engagement Plan

**Status:** 🟠 Active — firm selection in progress
**Owner:** LumenFlow security lead
**Blocks:** mainnet deployment (see [audit-report-v1.0.md §10](audit-report-v1.0.md#10-conclusion-and-mainnet-deployment-readiness))
**Last updated:** 2026-08-28

This plan defines *how* LumenFlow commissions an independent third-party audit
of the Soroban smart contracts before mainnet, what the deliverables are, and
the gates that must be cleared before funds can move on mainnet. The audit
findings themselves are published in
[`audit-report-v1.0.md`](audit-report-v1.0.md).

Readiness is machine-checked by
[`scripts/audit-readiness-check.sh`](../../scripts/audit-readiness-check.sh).

---

## 1. Objective

Obtain a written, published security assessment of the production contract code
from a reputable, independent Soroban/Stellar audit firm, with all Critical and
High findings remediated and re-verified **before** mainnet deployment.

Non-goals: this engagement does not replace internal review, fuzzing, or the
[threat model](threat-model-refund-flows.md); it is an additional independent
layer.

---

## 2. Scope of the audit

### In scope

| Component | Path |
|-----------|------|
| Contract entry points (all `#[contractimpl]` fns) | `contracts/lumenflow/src/lib.rs` |
| Data structures / storage types | `contracts/lumenflow/src/types.rs` |
| Persistent storage helpers | `contracts/lumenflow/src/storage.rs` |
| Error definitions | `contracts/lumenflow/src/error.rs` |
| Auth / signature helpers | `contracts/lumenflow/src/helper.rs` |
| Router contract | `contracts/router/src/` |
| Compiled WASM artifact | `target/wasm32-unknown-unknown/release/lumenflow.wasm` |

### Out of scope

- CLI tooling (`cli/`), SDK (`sdk/`), frontend (`frontend/`), dashboards
- CI/CD workflows (`.github/`) and deployment scripts (`scripts/`)
- Off-chain infrastructure (`infra/`, `monitoring/`)
- Third-party dependencies (reported upstream; tracked via `cargo audit`)

### Focus areas (from scoping + threat model)

1. Ed25519 signature verification and canonical payload construction
   (`process_payment_with_signature`, nonce handling — regression VDR-001/003).
2. Role separation: admin vs merchant vs payer vs pause-guardian.
3. Refund lifecycle: window enforcement, cumulative refund accounting,
   authorization matrix.
4. Multisig threshold enforcement and replay protection.
5. Persistent storage key design and collision analysis
   ([ADR-004](../adr/ADR-004-storage-key-design.md)).
6. Arithmetic: overflow/underflow, saturating semantics
   ([ADR-001](../adr/ADR-001-saturating-arithmetic.md)).
7. Pause / emergency-stop mechanism and timelock
   ([ADR-005](../adr/ADR-005-contract-pause-mechanism.md)).
8. Rate limiting and DoS vectors in contract execution.

---

## 3. Firm selection

### Mandatory criteria

- Demonstrated Soroban/Stellar smart-contract audit experience.
- WASM binary analysis capability (decompile + diff against source).
- At least **three** publicly disclosed prior Soroban audit reports.
- No conflict of interest with LumenFlow contributors or investors.
- Ability to start within 4 weeks and deliver within the timeline in §5.

### Selection process

| Step | Artifact | Owner |
|------|----------|-------|
| 1. Draft RFP from this scope | `docs/audit/rfp/` (private) | security lead |
| 2. Send RFP to ≥ 3 candidate firms | — | security lead |
| 3. Score proposals (experience 40%, methodology 30%, timeline 15%, price 15%) | scoring sheet (private) | security lead + maintainer |
| 4. Reference checks with ≥ 2 prior clients per finalist | — | security lead |
| 5. Engage; sign SOW + mutual NDA | signed SOW (private) | project maintainer |
| 6. Record firm name + engagement dates | `audit-report-v1.0.md` §1 | security lead |

Candidate firm list and proposals are kept private (they may contain pricing and
contact details) and are **not** committed to this repo.

---

## 4. Auditor handoff package

On kickoff, provide the firm with:

- [ ] Read access to the repo at a **frozen commit** (code freeze — see §5).
- [ ] This plan + [threat model](threat-model-refund-flows.md).
- [ ] Architecture docs: [ARCHITECTURE.md](../ARCHITECTURE.md),
      [auth-model.md](../auth-model.md), [storage-schema.md](../storage-schema.md),
      [signature-format.md](../signature-format.md), all
      [ADRs](../adr/).
- [ ] Full test suite + coverage report (`cargo test`, `codecov.yml`).
- [ ] Existing property/fuzz tests (`contracts/lumenflow/src/prop_tests.rs`).
- [ ] [Security regression catalogue](../security/regression-catalog.md).
- [ ] Reproducible build instructions + expected WASM hash
      ([release-hashes.md](../release-hashes.md), `scripts/verify-build.sh`).
- [ ] A dedicated point of contact and a private channel for findings.

---

## 5. Timeline

| Milestone | Target | Status |
|-----------|--------|--------|
| RFP issued to candidate firms | 2026-07-01 | ✅ |
| Firm selected and engaged | 2026-07-15 | ✅ |
| **Code freeze** on audit branch | 2026-07-22 | ✅ |
| Audit kickoff | 2026-07-22 | ✅ |
| Preliminary findings delivered | 2026-08-15 | ⏳ |
| Remediation window | 2026-08-15 → 2026-09-01 | ⏳ |
| Fixes re-verified by auditor | 2026-09-05 | ⏳ |
| Final report delivered + published | 2026-09-08 | ⏳ |
| Mainnet go/no-go review | 2026-09-10 | ⏳ |

Code freeze policy: during the audit window, only audit-finding remediations and
documentation changes may merge to the audit branch. Feature work continues on
`main` and is re-based after the engagement (triggering a scoped re-audit per
§7 if contract logic changed).

---

## 6. Remediation & severity policy

| Severity | Remediation SLA | Mainnet gate |
|----------|-----------------|--------------|
| 🔴 Critical | Fix PR merged + **auditor re-verification** | **Blocks mainnet** |
| 🟠 High | Fix PR merged before mainnet | **Blocks mainnet** |
| 🟡 Medium | Tracking issue with planned fix version | Documented, non-blocking |
| 🔵 Low / ℹ️ Info | Team discretion; noted in `CHANGELOG.md` | Non-blocking |

Each finding is tracked in the remediation table of
[`audit-report-v1.0.md` §9](audit-report-v1.0.md#9-remediation-tracking) with a
linked PR and fix version.

---

## 7. Re-audit triggers

A re-audit is commissioned (same firm preferred) if **any** of:

- A Critical finding is identified → targeted re-audit of the affected functions
  after remediation.
- Contract logic changes materially after the audit window.
- More than **6 months** elapse between the final report and mainnet deployment.

---

## 8. Mainnet deployment gate

Mainnet deployment is **BLOCKED** until every box is checked:

- [ ] Final audit report delivered and published in `docs/audit/`.
- [ ] Zero unresolved Critical findings; all Critical fixes re-verified.
- [ ] Zero unresolved High findings.
- [ ] All Medium findings have tracking issues with planned fix versions.
- [ ] `audit-report-v1.0.md` updated with the firm's name and sign-off.
- [ ] Deployed WASM hash matches the audited commit
      (`scripts/verify-build.sh`).
- [ ] `./scripts/audit-readiness-check.sh` exits 0.
- [ ] Go/no-go review recorded with maintainer + security lead sign-off.

---

## 9. Failure, permission & boundary handling

| Situation | Response |
|-----------|----------|
| No firm meets the mandatory criteria | Widen the search / accept a longer timeline; **do not** deploy to mainnet without an independent audit. |
| Firm withdraws mid-engagement | Re-scope with a replacement firm from the finalist list; restart the code-freeze clock. |
| Critical finding cannot be fixed without a redesign | Mainnet stays blocked; open a design ADR; re-audit the redesign. |
| Auditor requests production secrets | Denied. Auditors receive source, tests, and testnet access only — never mainnet keys or admin secrets. |
| Disagreement on a finding's severity | Escalate to the go/no-go review; the more conservative severity applies until resolved. |
| Audit branch diverges from `main` during freeze | Re-base after the engagement; run `git diff` on in-scope paths; scoped re-audit if non-trivial. |

---

## 10. Related documents

- [audit-report.md](audit-report.md) — audit plan summary / pointer
- [audit-report-v1.0.md](audit-report-v1.0.md) — findings + remediation tracking
- [threat-model-refund-flows.md](threat-model-refund-flows.md)
- [../security/regression-catalog.md](../security/regression-catalog.md)
- [../security/vulnerability-disclosure-and-incident-response.md](../security/vulnerability-disclosure-and-incident-response.md)
- [SECURITY.md](../../SECURITY.md)
