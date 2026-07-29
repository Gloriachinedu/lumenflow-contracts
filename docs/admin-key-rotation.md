# Admin Key Rotation

This document describes the procedure for rotating the LumenFlow contract admin key. The admin key controls all privileged contract operations (pausing, token management, fee configuration, merchant deactivation, and payment cleanup). Rotation must be treated as a critical operational event.

**⚠️ This procedure requires two-person integrity. Key rotation must be witnessed and co-signed by a second authorized operator before execution on mainnet.**

---

## Table of Contents

1. [When to Rotate](#1-when-to-rotate)
2. [Prerequisites and HSM Setup](#2-prerequisites-and-hsm-setup)
3. [Planned Rotation Runbook](#3-planned-rotation-runbook)
4. [Emergency Rotation Runbook](#4-emergency-rotation-runbook-compromised-key)
5. [Post-Rotation Verification](#5-post-rotation-verification)
6. [Two-Person Integrity Checklist](#6-two-person-integrity-checklist)
7. [Record Keeping](#7-record-keeping)

---

## 1. When to Rotate

Rotate the admin key under the following circumstances:

| Scenario | Priority |
|---|---|
| Planned key rotation (every 90 days for mainnet) | Scheduled |
| Departure of an authorized key holder | Within 24 hours |
| Suspected or confirmed key compromise | **Immediate — see Emergency Runbook** |
| HSM device failure or replacement | Within 4 hours |
| Security audit finding | Per audit remediation SLA |

---

## 2. Prerequisites and HSM Setup

### Required hardware

The admin key **must** be stored in a Hardware Security Module (HSM) for all production (mainnet) deployments. Acceptable HSM options:

- [YubiHSM 2](https://www.yubico.com/product/yubihsm-2/)
- [Thales Luna Network HSM](https://cpl.thalesgroup.com/encryption/hardware-security-modules/network-hsms)
- AWS CloudHSM (if using AWS-based infrastructure)
- Ledger Hardware Wallet (for smaller deployments)

Testnet and staging environments may use software keys, but must never share key material with mainnet.

### HSM initial setup (per device)

```bash
# Initialize the HSM domain and authentication key
# Replace <ADMIN_AUTH_PASSWORD> with a strong, randomly generated password
# stored in a secrets manager (not in source control)
yubihsm-shell -p password -c "put authkey 0 admin-auth 1 all all <ADMIN_AUTH_PASSWORD>"

# Generate the admin signing key on the HSM — the private key never leaves the device
yubihsm-shell -p <ADMIN_AUTH_PASSWORD> -c "generate asymmetric 0 admin-key 1 sign-eddsa ed25519"

# Export the public key for use in the contract
yubihsm-shell -p <ADMIN_AUTH_PASSWORD> -c "get public-key 0 admin-key"
```

Store the HSM authentication password in a secrets manager (e.g., HashiCorp Vault, AWS Secrets Manager). The password must be split across at least two key holders using [Shamir's Secret Sharing](https://en.wikipedia.org/wiki/Shamir%27s_secret_sharing) for mainnet.

### Required operator access

Before starting any rotation:

- [ ] Both operators (current and witness) have authenticated to their HSM devices
- [ ] Both operators are on a secure, end-to-end encrypted call or in person
- [ ] The Stellar CLI is installed and configured on the operator's workstation
- [ ] The current contract `CONTRACT_ID` is confirmed and verified
- [ ] The new admin public address has been generated on the new HSM and verified

---

## 3. Planned Rotation Runbook

This section covers routine, scheduled key rotation with no active security incident.

### Step 1 — Generate the new admin key

Generate the new admin key on the replacement HSM device **before** the rotation window:

```bash
# On the new HSM device
yubihsm-shell -p <NEW_HSM_AUTH_PASSWORD> \
  -c "generate asymmetric 0 new-admin-key 1 sign-eddsa ed25519"

# Retrieve and record the new public key
NEW_ADMIN_ADDR=$(yubihsm-shell -p <NEW_HSM_AUTH_PASSWORD> \
  -c "get public-key 0 new-admin-key")

echo "New admin address: $NEW_ADMIN_ADDR"
```

### Step 2 — Confirm the current admin address

```bash
# Verify which address is currently set as admin
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$CURRENT_ADMIN_KEY" \
  --network mainnet \
  -- get_contract_version

# Cross-check with storage: confirm $CURRENT_ADMIN_ADDR matches on-chain state
```

### Step 3 — Pause the contract (optional but recommended)

For mainnet rotations during high-traffic periods, pause the contract to prevent transactions during the handover window:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$CURRENT_ADMIN_KEY" \
  --network mainnet \
  -- pause_contract \
  --admin "$CURRENT_ADMIN_ADDR"
```

### Step 4 — Execute transfer_admin

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$CURRENT_ADMIN_KEY" \
  --network mainnet \
  -- transfer_admin \
  --current_admin "$CURRENT_ADMIN_ADDR" \
  --new_admin "$NEW_ADMIN_ADDR"
```

The transaction **must be signed by the current admin key from the HSM**. The witness operator must observe the command, the transaction hash, and the resulting event.

### Step 5 — Verify the transfer on-chain

```bash
# Query the contract to confirm the new admin is active
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$NEW_ADMIN_KEY" \
  --network mainnet \
  -- get_global_payment_stats \
  --admin "$NEW_ADMIN_ADDR"
```

A successful response confirms the new admin address has been accepted.

### Step 6 — Unpause the contract

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$NEW_ADMIN_KEY" \
  --network mainnet \
  -- unpause_contract \
  --admin "$NEW_ADMIN_ADDR"
```

### Step 7 — Retire the old HSM device

- Revoke the old HSM authentication key
- Physically destroy or securely wipe the old HSM per your organization's decommissioning policy
- Update all secret stores with the new admin public address

---

## 4. Emergency Rotation Runbook (Compromised Key)

Use this runbook if the admin key is known or suspected to be compromised.

**Do not delay. A compromised admin key can pause the contract, drain tokens, or permanently alter contract configuration.**

### Immediate response (0–30 minutes)

1. **Alert the security team** — contact security@lumenflow.dev and your internal incident commander immediately.
2. **Prepare the replacement key** — if a pre-generated backup admin key exists on a secondary HSM, proceed immediately to step 3. If not, generate one now (see Step 1 of Planned Rotation).
3. **Execute transfer_admin** using the backup key:

```bash
# Use the pre-approved emergency backup admin key
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$EMERGENCY_ADMIN_KEY" \
  --network mainnet \
  -- transfer_admin \
  --current_admin "$COMPROMISED_ADMIN_ADDR" \
  --new_admin "$NEW_ADMIN_ADDR"
```

> **Note:** If the attacker has already executed `transfer_admin` to seize the admin role, the contract admin is lost. In this case, contact the Stellar network validators and consider deploying a new contract instance. See the incident response plan in [SECURITY.md](../SECURITY.md).

4. **Pause the contract** immediately after transfer to stop any in-flight malicious transactions:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$NEW_ADMIN_KEY" \
  --network mainnet \
  -- pause_contract \
  --admin "$NEW_ADMIN_ADDR"
```

5. **Audit all actions taken** since the suspected compromise. Review Horizon event logs for `lumenflow/admin_set`, `lumenflow/merchant_deactivated`, `lumenflow/payment_archived`, and any token management events.

### Containment (30 minutes – 4 hours)

- Rotate all secrets associated with the compromised key (deployment keys, CI secrets, webhook tokens).
- Notify affected merchants and users if any merchant deactivations or payment manipulations occurred.
- File an internal incident report.

### Recovery (4–24 hours)

- Unpause the contract once all malicious activity is contained.
- Publish a security advisory per the disclosure policy in [SECURITY.md](../SECURITY.md).
- Perform a full audit of contract state to verify integrity.

---

## 5. Post-Rotation Verification

After any rotation (planned or emergency), complete the following checklist:

```bash
# 1. Confirm new admin address is set
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$NEW_ADMIN_KEY" \
  --network mainnet \
  -- get_global_payment_stats \
  --admin "$NEW_ADMIN_ADDR"

# 2. Confirm old admin address is rejected
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$OLD_ADMIN_KEY" \
  --network mainnet \
  -- pause_contract \
  --admin "$OLD_ADMIN_ADDR"
# Expected: error (Unauthorized or NotAdmin)

# 3. Confirm contract is unpaused and accepting payments
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$NEW_ADMIN_KEY" \
  --network mainnet \
  -- get_contract_version
```

---

## 6. Two-Person Integrity Checklist

All production key rotations must be witnessed. Both operators must sign the rotation log.

| Step | Operator 1 (Executor) | Operator 2 (Witness) |
|---|---|---|
| New key generated and public address verified | ☐ | ☐ |
| `transfer_admin` command reviewed before execution | ☐ | ☐ |
| Transaction hash recorded | ☐ | ☐ |
| On-chain verification completed | ☐ | ☐ |
| Old HSM device decommissioned | ☐ | ☐ |
| Secret stores updated | ☐ | ☐ |
| Incident/rotation log filed | ☐ | ☐ |

**Rotation log template:**

```
Date: YYYY-MM-DD
Old admin address: G...
New admin address: G...
Transaction hash: <Stellar transaction ID>
Executor: [Name, role]
Witness: [Name, role]
Reason for rotation: [Planned / Compromise / HSM failure / Personnel change]
Notes:
```

Store the completed log in your organization's secure audit trail system.

---

## 7. Record Keeping

- All key rotation events must be logged with the date, operator, witness, transaction hash, and reason.
- Logs must be retained for a minimum of 2 years.
- The current admin public address must be updated in:
  - Internal secret management system
  - CI/CD secrets (`TESTNET_ADMIN_KEY`, `TESTNET_ADMIN_ADDRESS` for testnet environments)
  - Any monitoring dashboards or alert configurations referencing the admin address

---

## Related Documents

- [SECURITY.md](../SECURITY.md) — responsible disclosure and incident response
- [docs/auth-model.md](auth-model.md) — contract authorization model
- [docs/deployment-guide.md](deployment-guide.md) — contract deployment procedures
- [docs/secrets-and-local-env.md](secrets-and-local-env.md) — managing secrets and local credentials
