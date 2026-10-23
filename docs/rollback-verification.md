# Automated Rollback Verification

This document describes the automated rollback verification process that runs after
a canary deployment is rolled back in LumenFlow.

---

## Overview

After `scripts/rollback-canary.sh` executes, the deployment is only considered
safe when **four conditions are verified**:

1. The canonical contract ID file points to the stable contract.
2. The canary contract ID slot is empty (canary decommissioned).
3. The stable contract is responsive and not paused.
4. The smoke test passes against the stable contract.

These checks are performed by `scripts/verify-rollback.sh` and can be run
automatically via `.github/workflows/rollback-verification.yml`.

---

## Components

### `scripts/verify-rollback.sh`

A standalone shell script that performs all four verification checks locally or
in CI. Can be run after any rollback to confirm the stable contract is healthy.

**Usage:**

```bash
NETWORK=testnet \
STABLE_CONTRACT_ID=<stable-contract-id> \
ADMIN_KEY=<admin-secret> \
MERCHANT_KEY=<merchant-secret> \
PAYER_KEY=<payer-secret> \
TOKEN_ADDRESS=<token-address> \
ADMIN_ADDRESS=<admin-address> \
MERCHANT_ADDRESS=<merchant-address> \
PAYER_ADDRESS=<payer-address> \
./scripts/verify-rollback.sh
```

**Dry-run (skip smoke test):**

```bash
NETWORK=testnet \
STABLE_CONTRACT_ID=<contract-id> \
SKIP_SMOKE=true \
./scripts/verify-rollback.sh
```

**Exit codes:**
- `0` — all checks passed; rollback is verified
- `1` — one or more checks failed; see output

### `.github/workflows/rollback-verification.yml`

GitHub Actions workflow that runs `verify-rollback.sh` in CI. Can be triggered:

- **Manually** via `workflow_dispatch` — provide the stable contract ID, network,
  and whether to skip the smoke test.
- **Programmatically** via `workflow_call` — called by other workflows (e.g., the
  deploy workflow when it rolls back after a failed smoke test).

The workflow uploads a verification log as a build artifact and posts a summary
table to the workflow run summary.

---

## Canary Rollback + Verification Flow

```
deploy-canary.sh
    │
    ├──► smoke test / canary monitoring
    │         │
    │    [failure detected]
    │         │
    ▼         ▼
rollback-canary.sh
    │
    ▼
verify-rollback.sh (or rollback-verification.yml)
    │
    ├── [1] Canonical ID file → stable?  ✅ / ❌
    ├── [2] Canary slot empty?           ✅ / ❌
    ├── [3] Stable contract responsive?  ✅ / ❌
    └── [4] Smoke test passes?           ✅ / ❌
              │
         [all pass]
              │
              ▼
         Rollback confirmed ✅
```

---

## Triggering Rollback Verification Manually

1. Go to `Actions → Canary Rollback Verification → Run workflow`.
2. Enter the **stable contract ID** (the one that should be active after rollback).
3. Select the **network** (`testnet` or `mainnet`).
4. Leave `skip_smoke` as `false` for a full verification.
5. Click **Run workflow**.

---

## Verification Checks in Detail

### Check 1: Canonical ID file

The script reads `<network>-contract-id.txt` from the workspace root and compares
it against the provided `STABLE_CONTRACT_ID`. This confirms `rollback-canary.sh`
wrote the correct ID to the canonical reference file.

**Failure:** The file is missing, empty, or contains a different contract ID.

### Check 2: Canary slot

Reads `canary-contract-id.txt` and confirms it is empty. A non-empty canary slot
indicates the rollback may be incomplete.

**Failure:** `canary-contract-id.txt` still contains a contract ID.

### Check 3: Liveness probe

Invokes `get_contract_version` on the stable contract. If the contract is paused,
all invocations (including read-only ones) fail with `ContractPaused`, so this
check distinguishes between "deployed but paused" and "deployed and active".

Requires the Stellar CLI to be installed. If the CLI is not found, the check is
skipped with a warning (does not fail the overall verification).

**Failure:** The contract returns a paused error or does not respond.

### Check 4: Smoke test

Runs `scripts/smoke_test.sh` against the stable contract. This exercises the full
admin → merchant → payment path and confirms end-to-end functionality.

If smoke test credentials (`ADMIN_KEY`, `MERCHANT_KEY`, etc.) are not set, or if
`SKIP_SMOKE=true`, the check is skipped with a warning.

**Failure:** Any step in the smoke test returns a non-zero exit code.

---

## Failure Remediation

| Failed check | Likely cause | Remediation |
|---|---|---|
| Check 1: Canonical ID | `rollback-canary.sh` was not run, or the wrong ID was given | Run `rollback-canary.sh` again; verify `STABLE_CONTRACT_ID` is correct |
| Check 2: Canary slot | Rollback incomplete; canary ID still present | Manually empty `canary-contract-id.txt`: `> canary-contract-id.txt` |
| Check 3: Liveness | Contract was paused during rollback | Unpause: `stellar contract invoke --id $STABLE_CONTRACT_ID --network $NETWORK -- unpause_contract --admin $ADMIN_ADDRESS` |
| Check 4: Smoke test | Stable contract is unhealthy; key mismatch; network issue | Review smoke test log; check credentials; see `docs/troubleshooting.md` |

For all failures, follow the escalation path in
`docs/runbooks/incident-response-runbook.md`.

---

## Integration with `deploy-testnet.yml`

The existing `deploy-testnet.yml` workflow already rolls back (pauses) the contract
when the smoke test fails. Teams can call `rollback-verification.yml` as a follow-up
step to confirm the stable contract is healthy after that automatic pause.

Example (adding to an existing workflow):

```yaml
- name: Trigger rollback verification
  if: failure() && steps.deploy.outputs.contract_id != ''
  uses: ./.github/workflows/rollback-verification.yml
  with:
    stable_contract_id: ${{ vars.LAST_KNOWN_GOOD_CONTRACT_ID }}
    network: testnet
    skip_smoke: 'false'
  secrets: inherit
```

---

## References

- `scripts/rollback-canary.sh` — Rollback implementation
- `scripts/verify-rollback.sh` — Verification script
- `.github/workflows/rollback-verification.yml` — CI verification workflow
- `.github/workflows/deploy-testnet.yml` — Testnet deploy (auto-rollback on failure)
- `docs/runbooks/incident-response-runbook.md` — Escalation and incident response
