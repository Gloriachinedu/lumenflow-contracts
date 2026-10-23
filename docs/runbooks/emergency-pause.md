# Emergency Pause Runbook

**Severity:** Critical  
**Estimated time to execute:** 5–10 minutes  
**Authorization required:** Contract admin

---

## Purpose

This runbook defines the steps to emergency-pause the LumenFlow contract. Pausing halts all payment processing, refund execution, and merchant registration. It does not destroy state — all data is preserved and the contract can be unpaused.

See [Emergency Unpause Runbook](emergency-unpause.md) for the recovery procedure.

---

## Conditions That Warrant a Pause

Pause the contract immediately if any of the following are observed:

- A critical vulnerability is discovered in the contract logic or signature verification.
- Unusual or suspicious payment activity exceeds safety thresholds (see `lumenflow/suspicious_activity` events).
- A compromised or lost admin key is suspected.
- An upstream dependency (e.g., SAC token contract) is behaving unexpectedly.
- A coordinated attack or exploit attempt is detected via monitoring.

When in doubt, pause first and investigate after.

---

## Authorization

Only the account set as the contract admin via `set_admin` may pause the contract.

| Role | Action |
|------|--------|
| Contract admin | Execute pause |
| Core team members | Escalate to admin, assist investigation |
| General public | Report via [SECURITY.md](../../SECURITY.md) |

If the admin key is unavailable or compromised, follow the [Incident Response — Compromised Admin Key](#compromised-admin-key) section below.

---

## Pre-Pause Checklist

- [ ] Confirm the incident warrants an emergency pause (see conditions above).
- [ ] Notify the core team on the emergency channel (Discord `#incidents` or direct message).
- [ ] Ensure you have access to the admin secret key.
- [ ] Record the timestamp, reason, and network in the incident log.

---

## Pause Procedure

### Step 1 — Confirm admin key is accessible

```bash
# Verify account is funded and active
stellar account show --account <ADMIN_PUBLIC_KEY> --network <NETWORK>
```

### Step 2 — Pause the contract

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <ADMIN_SECRET_KEY> \
  --network <NETWORK> \
  -- pause_contract \
  --admin <ADMIN_PUBLIC_KEY>
```

Expected output: the transaction succeeds with no error.

> **Note:** Replace `<CONTRACT_ID>`, `<ADMIN_SECRET_KEY>`, `<ADMIN_PUBLIC_KEY>`, and `<NETWORK>` with the actual values from your deployment manifest (`deployments/<network>.json`).

### Step 3 — Verify the contract is paused

Attempt a state-mutating call that would normally succeed. After pausing, any such call should return error code `70` (`ContractPaused`):

```bash
# This should fail with ContractPaused (error 70)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <ANY_KEY> \
  --network <NETWORK> \
  -- register_merchant \
  --merchant_address <ANY_ADDRESS> \
  --name "pause-test" \
  --description "test" \
  --contact_info "test@test.com" \
  --category Other
```

If the call returns error `70`, the pause is confirmed.

### Step 4 — Notify stakeholders

- Post an announcement in Discord `#announcements`.
- Update the status page (if applicable).
- Notify active merchants by email (if configured in off-chain systems).

### Step 5 — Investigate the incident

- Review recent events via Horizon SSE or Stellar Explorer.
- Check for `lumenflow/suspicious_activity` events.
- Identify root cause.
- Document findings in the incident log.

---

## Compromised Admin Key

If the admin key is lost or compromised and the contract cannot be paused through normal means:

1. **Do not attempt to recover the key** on an insecure machine.
2. Contact the Stellar network's validator community if the incident involves Stellar-layer vulnerabilities.
3. Publicly disclose the incident following [SECURITY.md](../../SECURITY.md) procedures.
4. Plan a contract redeployment using the [Rollback Strategy](../deployment-guide.md#rollback-strategy).

> Soroban contracts are immutable — if the admin key is permanently lost and the contract cannot be paused, a new contract must be deployed and traffic migrated.

---

## Post-Pause Actions

- [ ] Incident log updated with: timestamp, reason, network, contract ID, admin address.
- [ ] Core team notified.
- [ ] Monitoring alerts acknowledged.
- [ ] Root cause investigation underway.
- [ ] Stakeholders notified of service interruption.

---

## Escalation Contacts

See [SECURITY.md](../../SECURITY.md) for responsible disclosure contacts.
