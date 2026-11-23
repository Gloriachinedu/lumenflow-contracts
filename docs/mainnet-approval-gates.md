# Mainnet Deployment Approval Gates

This document describes the approval gate process required before any contract is
deployed to the Stellar mainnet in LumenFlow.

---

## Overview

Mainnet deployments require **mandatory human approval** before any code is deployed.
This prevents accidental, untested, or malicious pushes from reaching production.

The approval gate is enforced by the GitHub Environment `mainnet-production` which
must have at least **2 required reviewers** configured in the repository settings,
with **Prevent self-review** enabled. The deploy job will not proceed until the
required number of approvals is received.

In addition to the environment protection rules, the workflow itself performs
automated gate validation (see Stage 3 below) and independently verifies the number
of distinct approvers via the GitHub API before deploying.

---

## Workflow: `deploy-mainnet.yml`

The mainnet deployment workflow has five sequential stages:

```
preflight → audit-readiness → validate-gates → await-approval (gate) → deploy
```

### Stage 1: Pre-flight Checks

Runs automatically when the workflow is triggered. Performs:

- Full WASM build with size check (must be ≤ 100 KB)
- Full test suite (`cargo test --all-features`)
- Audit readiness check (`scripts/audit-readiness-check.sh`)
- Records deploy metadata (branch, commit, actor, reason) in the workflow summary

If any pre-flight check fails, the approval gate is never reached. The deploy is
aborted before any reviewer time is spent.

### Stage 2: Audit Readiness

Runs `scripts/audit-readiness-check.sh` to confirm the audit report exists and is
linked from the release notes. A failure here stops the workflow before any reviewer
is notified.

### Stage 3: Validate Gates (Automated Enforcement)

The `validate-gates` job blocks the deployment unless **both** of the following
conditions hold. It fails the workflow (and therefore never reaches the approval
gate) if either check fails:

1. **Audit report linked in release notes** — the release notes for the target
   tag/commit must contain a link to the audit report. The job greps the release
   notes body for a markdown link to the audit report path.
2. **Successful testnet smoke test within the last 24 hours** — the job queries the
   GitHub Actions API for recent successful runs of the testnet smoke test
   workflow. The exact query used is:

   ```
   GET /repos/{owner}/{repo}/actions/workflows/testnet-smoke.yml/runs
       ?status=success
       &created=>={now - 24h}
       &per_page=1
   ```

   If no successful run exists within the 24-hour window, the gate fails and the
   deploy is blocked. The qualifying run(s) are recorded for the audit trail.

### Stage 4: Await Approval (Gate)

Uses the `mainnet-production` GitHub Environment to pause execution and notify
required reviewers. The job expires after **24 hours** if not approved.

Reviewers receive a GitHub notification and can approve or reject the pending
deployment from the Actions UI or via email link.

Once the environment gate is satisfied, the job queries the GitHub API for the
pending deployment's reviews and verifies that there are **at least 2 distinct
approvers** (self-reviews are rejected). It then records each approver's name and
approval timestamp for the audit trail.

### Stage 5: Deploy

Runs only after the approval gate is passed. Deploys the contract and optionally
runs a post-deploy smoke test. On failure, pauses the contract and sends a Slack alert.

---

## Setting Up the Approval Gate

**One-time repository configuration (owner only):**

1. Go to `Settings → Environments → New environment`.
2. Name it exactly: `mainnet-production`.
3. Under **Required reviewers**, add at least 2 maintainers.
4. Enable **Prevent self-review** (a reviewer cannot approve their own deploy).
5. Optionally set a **Deployment branch rule** to restrict to `main` and `release/*`.
6. Add the following secrets to the `mainnet-production` environment scope:
   - `MAINNET_DEPLOYER_KEY`
   - `MAINNET_ADMIN_KEY`
   - `MAINNET_SOURCE_ACCOUNT`
   - `MAINNET_ADMIN_ADDRESS`

---

## Triggering a Mainnet Deploy

Mainnet deploys are triggered **manually only** via `workflow_dispatch`:

1. Go to `Actions → Deploy to Mainnet → Run workflow`.
2. Enter the **reason** for the deploy (required field — provides an audit trail).
3. Leave `skip_smoke` as `false` unless this is an emergency hotfix.
4. Click **Run workflow**.
5. The pre-flight checks run automatically.
6. Required reviewers receive a notification to approve or reject.
7. After approval, the deploy proceeds.

> **Note:** Only the `main` branch (or `release/*` branches) should be used to
> trigger mainnet deploys. Using an untested feature branch requires explicit
> justification in the reason field and reviewer awareness.

---

## Approval Expiry

If the required approvals are not received within **24 hours**, the workflow times
out and the deploy is cancelled. A new workflow run must be started.

This prevents stale deploys from being approved long after the context has changed.

---

## Emergency Deployments

In a genuine emergency (critical security fix), the `skip_smoke` option can be
set to `true` to skip the post-deploy smoke test. This must be:

1. Documented in the reason field.
2. Followed up immediately with a manual smoke test.
3. Tracked in the incident response runbook (`docs/runbooks/incident-response-runbook.md`).

Even emergency deploys require the full approval gate. There is no bypass.

---

## Failure Handling

| Failure point | Action |
|---|---|
| Pre-flight build/test fails | Workflow stops; no approval request sent |
| Audit readiness check fails | Workflow stops; no approval request sent |
| Audit report not linked in release notes | `validate-gates` fails; deploy blocked |
| No successful testnet smoke test in last 24h | `validate-gates` fails; deploy blocked |
| Fewer than 2 distinct approvers | `await-approval` fails; deploy blocked |
| Approval gate times out (24h) | Workflow cancelled; new run required |
| Deploy script fails | Slack alert fires; contract not live |
| Smoke test fails after deploy | Contract is automatically paused; Slack alert fires |
| Manual intervention needed | See `docs/runbooks/incident-response-runbook.md` |

---

## Audit Trail

Every mainnet deploy records the following in the workflow step summary **and** in
the deploy log artifact uploaded by the workflow:

- Branch and commit SHA
- The GitHub user who triggered the deploy (`github.actor`)
- The reason provided at trigger time
- The name of each approver and the timestamp of each approval
- The link to the audit report referenced in the release notes
- Links to the qualifying testnet smoke test run(s) from the last 24 hours
- Whether the smoke test was skipped

This information is retained with the workflow run history and the deploy log
artifact for compliance purposes.

---

## References

- `.github/workflows/deploy-mainnet.yml` — Mainnet deploy workflow
- `docs/deployment-guide.md` — Full deployment guide
- `docs/deployment-runbook.md` — Step-by-step deployment runbook
- `docs/runbooks/incident-response-runbook.md` — Incident response
- `docs/credential-separation.md` — Testnet/mainnet credential separation policy
