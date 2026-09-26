# Emergency Unpause Runbook

**Severity:** Critical  
**Estimated time to execute:** 5–15 minutes  
**Authorization required:** Contract admin + team sign-off

---

## Purpose

This runbook defines the steps to unpause the LumenFlow contract after an emergency pause. Before unpausing, the root cause of the original incident must be resolved and verified.

See [Emergency Pause Runbook](emergency-pause.md) for the pause procedure.

---

## Pre-Unpause Checklist

Do not unpause until **all** of the following are confirmed:

- [ ] Root cause of the original incident has been identified.
- [ ] The vulnerability or threat has been remediated (e.g., new contract deployed, compromised key rotated, off-chain systems patched).
- [ ] At least two core team members have reviewed and approved the unpausing decision.
- [ ] A post-mortem has been drafted or scheduled.
- [ ] Stakeholder communication is prepared.
- [ ] Monitoring is active and alert thresholds are set.

---

## Authorization

| Role | Action |
|------|--------|
| Contract admin | Execute unpause |
| 2+ core team members | Approve the decision to unpause |

Record approval in the incident log (Discord thread, GitHub issue, or incident tracker) before proceeding.

---

## Unpause Procedure

### Step 1 — Confirm readiness

Verify the pre-unpause checklist above is complete. Do not skip any item.

### Step 2 — Verify contract is still paused

```bash
# Should return ContractPaused (error 70)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <ANY_KEY> \
  --network <NETWORK> \
  -- register_merchant \
  --merchant_address <ANY_ADDRESS> \
  --name "unpause-check" \
  --description "check" \
  --contact_info "check@check.com" \
  --category Other
```

### Step 3 — Unpause the contract

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <ADMIN_SECRET_KEY> \
  --network <NETWORK> \
  -- unpause_contract \
  --admin <ADMIN_PUBLIC_KEY>
```

Expected output: the transaction succeeds with no error.

### Step 4 — Verify the contract is operational

Run the read-only smoke test to confirm the contract is responding:

```bash
CONTRACT_ID=<CONTRACT_ID> \
ADMIN_ADDRESS=<ADMIN_ADDRESS> \
CALLER_KEY=<CALLER_KEY> \
NETWORK=<NETWORK> \
./scripts/smoke_test_readonly.sh
```

For testnet, you may also run the full smoke test:

```bash
CONTRACT_ID=<CONTRACT_ID> \
ADMIN_KEY=<ADMIN_SECRET_KEY> \
ADMIN_ADDRESS=<ADMIN_ADDRESS> \
MERCHANT_KEY=<MERCHANT_KEY> \
MERCHANT_ADDRESS=<MERCHANT_ADDRESS> \
PAYER_KEY=<PAYER_KEY> \
PAYER_ADDRESS=<PAYER_ADDRESS> \
TOKEN_ADDRESS=<TOKEN_ADDRESS> \
NETWORK=testnet \
./scripts/smoke_test.sh
```

### Step 5 — Notify stakeholders

- Post a service-restored announcement in Discord `#announcements`.
- Update the status page.
- Email affected merchants (if applicable).

### Step 6 — Monitor

Watch Horizon SSE events and monitoring dashboards for 30 minutes after unpausing:

```bash
# Watch for suspicious_activity events
# See docs/monitoring.md for full monitoring setup
```

---

## Post-Unpause Actions

- [ ] Incident log updated with: unpause timestamp, approvers, remediation summary.
- [ ] Post-mortem scheduled (within 48 hours of resolution).
- [ ] Monitoring confirmed active.
- [ ] Stakeholders notified of service restoration.
- [ ] CHANGELOG.md updated with incident note (if applicable).
- [ ] GitHub issue or security advisory closed.

---

## Escalation Contacts

See [SECURITY.md](../../SECURITY.md) for responsible disclosure and escalation contacts.
