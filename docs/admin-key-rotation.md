# Admin Key Rotation

Complete operational reference for rotating the LumenFlow contract admin key.
The admin address controls all privileged contract operations — pausing,
token management, fee configuration, merchant lifecycle, payment cleanup, and
contract upgrades. Rotation must be treated as a critical operational event.

**⚠️ Two-person integrity required. Every mainnet rotation must be witnessed
and co-signed by a second authorized operator before execution.**

---

## Table of Contents

1. [When to Rotate](#1-when-to-rotate)
2. [How `transfer_admin` Works](#2-how-transfer_admin-works)
3. [Auth Lockout — Know Before You Rotate](#3-auth-lockout--know-before-you-rotate)
4. [Prerequisites and HSM Setup](#4-prerequisites-and-hsm-setup)
5. [Planned Rotation Runbook](#5-planned-rotation-runbook)
6. [Emergency Rotation Runbook (Compromised Key)](#6-emergency-rotation-runbook-compromised-key)
7. [Incident Fallback — Admin Key Already Seized](#7-incident-fallback--admin-key-already-seized)
8. [Guardian-Based Early Unpause](#8-guardian-based-early-unpause)
9. [Post-Rotation Verification](#9-post-rotation-verification)
10. [Boundary Cases and Error Reference](#10-boundary-cases-and-error-reference)
11. [Two-Person Integrity Checklist](#11-two-person-integrity-checklist)
12. [Record Keeping](#12-record-keeping)

---

## 1. When to Rotate

| Scenario | Priority |
|----------|----------|
| Planned key rotation (every 90 days for mainnet) | Scheduled |
| Departure of an authorized key holder | Within 24 hours |
| Suspected or confirmed key compromise | **Immediate — see Emergency Runbook** |
| HSM device failure or replacement | Within 4 hours |
| Security audit finding | Per audit remediation SLA |
| `lumenflow/suspicious_activity` event with `ManyAuthFailures` reason | Investigate immediately; rotate if compromise confirmed |

---

## 2. How `transfer_admin` Works

Understanding the contract mechanics before executing a rotation prevents
irreversible mistakes.

### Function signature

```
transfer_admin(env, current_admin, new_admin) -> Result<(), PaymentError>
```

| Parameter | Type | Constraint |
|-----------|------|-----------|
| `current_admin` | `Address` | Must be the currently configured admin. Must sign the transaction. |
| `new_admin` | `Address` | The address to receive admin rights. Must be different from `current_admin` and must not be the zero address. |

### What it does

1. Calls `require_admin(env, &current_admin)` — verifies the caller is the
   stored admin and calls `current_admin.require_auth()`.
2. Checks `new_admin != current_admin` (blocks self-transfer).
3. Checks `new_admin` is not the all-zeros address (blocks permanent lockout).
4. Writes `new_admin` to the `Admin` instance storage key — **immediately and
   atomically**. There is no confirmation step or timelock.
5. Emits `lumenflow/admin_transferred` event with `(current_admin, new_admin)`.

### Irreversibility

`transfer_admin` takes effect in the same ledger it is executed. Once confirmed:

- The old admin address **immediately** loses all admin privileges.
- There is no cooldown, grace period, or undo path within the contract.
- If the `new_admin` key is inaccessible after transfer, **admin access is
  permanently lost** for that contract instance.

### Blocked cases (errors)

| Scenario | Error | Code |
|----------|-------|------|
| `current_admin` is not the stored admin | `Unauthorized` | 1 |
| `new_admin == current_admin` (self-transfer) | `InvalidAdminAddress` | 3 |
| `new_admin` is the all-zeros XDR address | `InvalidAdminAddress` | 3 |
| `current_admin` is in auth lockout | `AuthLockedOut` | 5 |
| Contract is paused | *(not blocked — rotation works while paused)* | — |

> **Note:** `transfer_admin` uses the bare `require_admin` helper, not
> `require_admin_rate_limited`, so the auth failure counter does **not** apply
> to `transfer_admin` itself. However, the lockout check in
> `require_admin_rate_limited` _does_ apply to all other admin functions. See
> section 3.

---

## 3. Auth Lockout — Know Before You Rotate

The contract tracks failed admin authentication attempts to detect brute-force
probing.

### Lockout parameters (from `storage.rs`)

| Constant | Value | Approximate real time |
|----------|-------|----------------------|
| `AUTH_MAX_FAILURES` | 10 | — |
| `AUTH_FAILURE_WINDOW_LEDGERS` | 100 ledgers | ~8 minutes |
| `AUTH_LOCKOUT_LEDGERS` | 1 000 ledgers | ~83 minutes |

After 10 failed admin-auth attempts within a 100-ledger window, the offending
address is locked out for 1 000 ledgers (~83 minutes). Any admin function
guarded by `require_admin_rate_limited` returns `AuthLockedOut` (5) for that
address until the lockout expires.

The `lumenflow/suspicious_activity` event with reason `ManyAuthFailures` is
emitted on the 10th failure.

### Which functions are affected

All admin-callable functions except `transfer_admin` use
`require_admin_rate_limited` and are therefore blocked during a lockout:

```
pause_contract         pause_with_reason      unpause_contract
set_payment_cleanup_period  set_platform_fee  set_large_payment_threshold
add_allowed_token      remove_allowed_token   set_refund_window
set_min_refund_amount  deactivate_merchant    reactivate_merchant
verify_merchant        cleanup_expired_payments  archive_payment_record
reset_auth_lockout     upgrade                set_contract_version
```

`transfer_admin` uses the non-rate-limited `require_admin` helper, so it is
**not blocked** during a lockout. You can still rotate the admin key even if
the current admin address is locked out.

### Clearing a lockout without waiting

If the legitimate admin is accidentally locked out, the admin can call
`reset_auth_lockout` to clear the counter for any address (including itself):

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK \
  -- reset_auth_lockout \
  --admin $ADMIN_ADDR \
  --address $LOCKED_ADDR
```

`reset_auth_lockout` is itself guarded by `require_admin_rate_limited`, so if
the admin address is locked out it must wait ~83 minutes for the lockout to
expire before calling it — or execute `transfer_admin` to a fresh address first
and then use the new admin to clear the lockout on the old address.

---

## 4. Prerequisites and HSM Setup

### Required hardware

The admin key **must** be stored in a Hardware Security Module (HSM) for all
production (mainnet) deployments:

| HSM Option | Notes |
|------------|-------|
| YubiHSM 2 | Recommended for on-premises deployments |
| Thales Luna Network HSM | Enterprise deployments |
| AWS CloudHSM | AWS-hosted infrastructure |
| Ledger Hardware Wallet | Acceptable for smaller deployments |

Testnet and staging may use software keys but **must never share key material
with mainnet**.

### HSM initial setup (per device)

```bash
# Initialize the HSM domain and authentication key
yubihsm-shell -p password \
  -c "put authkey 0 admin-auth 1 all all <ADMIN_AUTH_PASSWORD>"

# Generate the admin signing key on-device (private key never leaves)
yubihsm-shell -p <ADMIN_AUTH_PASSWORD> \
  -c "generate asymmetric 0 admin-key 1 sign-eddsa ed25519"

# Export the public key for use as the admin address
yubihsm-shell -p <ADMIN_AUTH_PASSWORD> \
  -c "get public-key 0 admin-key"
```

Store the HSM authentication password in a secrets manager (HashiCorp Vault,
AWS Secrets Manager). For mainnet, split the password across at least two key
holders using Shamir's Secret Sharing.

### Pre-rotation checklist

- [ ] Both operators have authenticated to their HSM devices
- [ ] Both operators are on an encrypted call or are physically co-located
- [ ] Stellar CLI is installed and configured
- [ ] `CONTRACT_ID` is confirmed and verified on-chain
- [ ] New admin public address has been generated on the replacement HSM and verified
- [ ] New admin account is funded with XLM for transaction fees
- [ ] A funded Stellar account is available to serve as the transaction fee payer

---

## 5. Planned Rotation Runbook

Use this runbook for scheduled, routine key rotations with no active security
incident.

### Step 1 — Generate the new admin key (before the rotation window)

```bash
# On the replacement HSM
yubihsm-shell -p <NEW_HSM_AUTH_PASSWORD> \
  -c "generate asymmetric 0 new-admin-key 1 sign-eddsa ed25519"

# Record the new public address
NEW_ADMIN_ADDR=$(yubihsm-shell -p <NEW_HSM_AUTH_PASSWORD> \
  -c "get public-key 0 new-admin-key")

echo "New admin address: $NEW_ADMIN_ADDR"
```

Fund the new admin address with XLM:

```bash
# Testnet:
curl "https://friendbot.stellar.org?addr=$NEW_ADMIN_ADDR"

# Mainnet: transfer from an exchange or funded wallet
```

### Step 2 — Confirm the current admin is operational

Verify the current admin can authenticate by calling a read-only admin function:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$CURRENT_ADMIN_KEY" \
  --network mainnet \
  -- get_global_payment_stats \
  --admin "$CURRENT_ADMIN_ADDR" \
  --date_start null --date_end null
```

If this fails with `AuthLockedOut`, the admin address is under a lockout. Wait
~83 minutes for it to expire, or follow the lockout-clearing steps in section 3.

### Step 3 — Pause the contract (recommended for mainnet)

Prevents new payments from being processed during the handover window. Use
`pause_with_reason` for mainnet to record the reason on-chain:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$CURRENT_ADMIN_KEY" \
  --network mainnet \
  -- pause_with_reason \
  --admin "$CURRENT_ADMIN_ADDR" \
  --reason "Scheduled admin key rotation"
```

`pause_with_reason` sets a **7-day unpause timelock**. Plan the rotation window
so the contract can be unpaused within 7 days, or use `pause_contract` (no
timelock) for short planned windows. See section 8 for early guardian unpause.

### Step 4 — Execute `transfer_admin`

The witness operator must observe the full command, parameters, and transaction
result before the executor submits:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$CURRENT_ADMIN_KEY" \
  --network mainnet \
  -- transfer_admin \
  --current_admin "$CURRENT_ADMIN_ADDR" \
  --new_admin "$NEW_ADMIN_ADDR"
```

Record the **transaction hash** immediately.

### Step 5 — Verify the transfer on-chain

Use the **new** admin key to call an admin-only function:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$NEW_ADMIN_KEY" \
  --network mainnet \
  -- get_global_payment_stats \
  --admin "$NEW_ADMIN_ADDR" \
  --date_start null --date_end null
```

A successful response confirms the new admin is active. Confirm the old admin
is rejected:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$OLD_ADMIN_KEY" \
  --network mainnet \
  -- pause_contract \
  --admin "$OLD_ADMIN_ADDR"
# Expected: error Unauthorized (1)
```

### Step 6 — Unpause the contract

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$NEW_ADMIN_KEY" \
  --network mainnet \
  -- unpause_contract \
  --admin "$NEW_ADMIN_ADDR"
```

If you used `pause_with_reason` and the 7-day timelock has not yet expired,
`unpause_contract` returns `TimelockActive` (72). Wait for the timelock to
expire, or use the guardian early-unpause path described in section 8.

### Step 7 — Retire the old HSM

- Revoke the old HSM authentication key.
- Physically destroy or securely wipe per your organization's decommissioning
  policy.
- Update all secret stores and CI secrets with the new admin address.

---

## 6. Emergency Rotation Runbook (Compromised Key)

Use this runbook if the admin key is known or suspected to be compromised.

> **Do not delay.** A compromised admin key can pause the contract, change fee
> recipients, deactivate merchants, archive payments, or transfer admin rights
> to an attacker-controlled address.

### Immediate response (0–30 minutes)

**1. Alert the security team**

Contact `security@lumenflow.dev` and your internal incident commander
immediately. Open an incident channel.

**2. Attempt to seize the admin role before the attacker does**

If a pre-generated emergency backup key exists on a secondary HSM, proceed
immediately. If not, generate one now (section 5, step 1).

```bash
# Use the emergency backup admin key
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$EMERGENCY_ADMIN_KEY" \
  --network mainnet \
  -- transfer_admin \
  --current_admin "$COMPROMISED_ADMIN_ADDR" \
  --new_admin "$EMERGENCY_ADMIN_ADDR"
```

**3. Pause immediately after transfer**

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$EMERGENCY_ADMIN_KEY" \
  --network mainnet \
  -- pause_with_reason \
  --admin "$EMERGENCY_ADMIN_ADDR" \
  --reason "Security incident — admin key compromise suspected"
```

**4. Audit on-chain events since suspected compromise**

Query Horizon for all events emitted by the contract since the suspected
compromise timestamp. Pay particular attention to:

| Event | What it signals |
|-------|----------------|
| `lumenflow/admin_transferred` | Attacker may have transferred admin to themselves |
| `lumenflow/contract_paused` | Attacker may have paused to deny service |
| `lumenflow/merchant_deactivated` | Attacker may have silenced merchants |
| `lumenflow/payment_archived` | Attacker may have deleted payment records |
| `lumenflow/token_allowed` / `token_removed` | Attacker may have manipulated token whitelist |
| `lumenflow/suspicious_activity` | Contract-level anomaly detection fired |

```bash
# Fetch all recent events (Horizon REST API)
curl "https://horizon.stellar.org/contracts/<CONTRACT_ID>/events?order=desc&limit=200"
```

### Containment (30 minutes – 4 hours)

- Rotate all secrets associated with the compromised key (deployment keys,
  CI secrets, webhook tokens, monitoring credentials).
- Notify affected merchants and users if any merchant deactivations or payment
  record manipulations occurred.
- File an internal incident report following your organization's IRP.

### Recovery (4–24 hours)

- Complete section 9 post-rotation verification.
- Unpause the contract once all malicious activity is contained (section 8 for
  early guardian unpause if the 7-day timelock applies).
- Publish a security advisory per [SECURITY.md](../SECURITY.md).
- Perform a full audit of contract state to verify integrity.

---

## 7. Incident Fallback — Admin Key Already Seized

This is the worst-case scenario: an attacker has already called `transfer_admin`
and the contract admin is now under the attacker's control.

### What you can and cannot do

| Action | Possible? | Notes |
|--------|-----------|-------|
| Re-take admin via `transfer_admin` | ❌ No | Only the current admin can call `transfer_admin`. If the attacker holds admin, they control it. |
| Pause the contract yourself | ❌ No | `pause_contract` is admin-only. |
| Read contract state | ✅ Yes | All read functions remain publicly accessible. |
| Call guardian early-unpause | ✅ Yes | If guardians were set before the seizure, they can vote for early unpause after a legitimate pause. Irrelevant if attacker hasn't paused. |
| Deploy a new contract instance | ✅ Yes | The safest recovery path. |

### Recovery procedure

**1. Immediately assess damage**

Audit all events from the `admin_transferred` transaction forward (see section 6
step 4). Determine whether payments were archived, tokens manipulated, or
merchants deactivated.

**2. Deploy a new contract instance**

```bash
git checkout <last-known-good-release-tag>
NETWORK=mainnet SOURCE_ACCOUNT=<deployer-secret> ./scripts/deploy.sh
```

Re-initialise with a new admin key:

```bash
stellar contract invoke \
  --id "$NEW_CONTRACT_ID" \
  --source-account "$NEW_ADMIN_KEY" \
  --network mainnet \
  -- set_admin --admin "$NEW_ADMIN_ADDR"
```

**3. Migrate integrations**

Update all integration points to the new contract ID:
- SDK configuration (`.lumenflow.toml`)
- Frontend environment variables (`LUMENFLOW_CONTRACT_ID`)
- Webhook Horizon SSE subscriptions
- CI/CD secrets
- Monitoring dashboards

**4. Re-register merchants**

Merchants must re-register on the new contract instance. Contact each merchant
with migration instructions.

**5. Notify Stellar validators (if warranted)**

For large-scale theft, contact the [Stellar Development Foundation security
team](https://www.stellar.org/security) and relevant Stellar validator operators.
Coordinate with your legal counsel for any required disclosures.

**6. Publish a post-mortem**

Follow the disclosure policy in [SECURITY.md](../SECURITY.md). A full incident
post-mortem should be published within 30 days.

---

## 8. Guardian-Based Early Unpause

When the contract is paused via `pause_with_reason`, a 7-day unpause timelock
is activated. The contract cannot be unpaused by the admin alone until the
timelock expires. To recover without waiting 7 days, 3 of the 5 registered
pause guardians must approve early unpause.

### Setting up guardians (before an incident)

```bash
# Register exactly 5 guardian addresses (admin only)
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY \
  --network $NETWORK \
  -- set_pause_guardians \
  --admin $ADMIN_ADDR \
  --guardians '["<guard1>","<guard2>","<guard3>","<guard4>","<guard5>"]'
```

Guardians should be:
- Held by trusted operators who are independent of the admin key holder
- Distributed across at least 3 different people or teams
- Stored on separate HSMs or hardware wallets

### Guardian early-unpause procedure

Each guardian calls `approve_early_unpause` from their own key. No admin
involvement is needed:

```bash
stellar contract invoke --id $CONTRACT_ID \
  --source-account $GUARDIAN_KEY_N \
  --network $NETWORK \
  -- approve_early_unpause \
  --guardian $GUARDIAN_ADDR_N
```

When 3 of the 5 guardians have approved, the contract **automatically unpauses**
and clears the timelock, pause reason, and approval list. No further admin
call is needed.

### Guardian approval rules

| Rule | Detail |
|------|--------|
| Minimum approvals to auto-unpause | 3 out of 5 (`EARLY_UNPAUSE_THRESHOLD = 3`) |
| Each guardian may vote once per pause event | Duplicate vote returns `AlreadyApprovedUnpause` (74) |
| Non-guardian address returns | `NotAPauseGuardian` (75) |
| Approval list is cleared on unpause | Guardians must re-vote after each new `pause_with_reason` |

### Guardian errors

| Code | Name | When |
|------|------|------|
| 75 | `NotAPauseGuardian` | Caller not in the guardian list |
| 74 | `AlreadyApprovedUnpause` | Guardian has already voted for this pause event |

---

## 9. Post-Rotation Verification

Complete this checklist after every rotation (planned or emergency).

### Verification commands

```bash
# 1. Confirm new admin is accepted for an admin-only read
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$NEW_ADMIN_KEY" \
  --network $NETWORK \
  -- get_global_payment_stats \
  --admin "$NEW_ADMIN_ADDR" \
  --date_start null --date_end null
# Expected: GlobalStats object returned (no error)

# 2. Confirm old admin is rejected
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$OLD_ADMIN_KEY" \
  --network $NETWORK \
  -- pause_contract \
  --admin "$OLD_ADMIN_ADDR"
# Expected: error PaymentError::Unauthorized (1)

# 3. Confirm contract is unpaused and accepting payments
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$ANY_KEY" \
  --network $NETWORK \
  -- get_contract_version
# Expected: version string returned

# 4. Confirm lumenflow/admin_transferred event on-chain
curl "https://horizon.stellar.org/contracts/$CONTRACT_ID/events?order=desc&limit=10" \
  | jq '.._embedded.records[] | select(.type=="contract") | {topic: .topic, value: .value}'
```

### Verification checklist

- [ ] New admin key successfully calls `get_global_payment_stats`
- [ ] Old admin key returns `Unauthorized` on any admin-only function
- [ ] `lumenflow/admin_transferred` event visible in Horizon with correct `(old, new)` payload
- [ ] Contract is unpaused (or pause state is intentional)
- [ ] All CI/CD secrets updated to new admin key and address
- [ ] All monitoring alert configs reference new admin address
- [ ] Secrets manager updated

---

## 10. Boundary Cases and Error Reference

### `transfer_admin` error table

| Scenario | Error | Code | What to do |
|----------|-------|------|------------|
| Caller is not the current admin | `Unauthorized` | 1 | Verify you are signing with the correct key matching the current admin address. |
| `new_admin == current_admin` | `InvalidAdminAddress` | 3 | Use a different address for the new admin. |
| `new_admin` is the all-zeros address | `InvalidAdminAddress` | 3 | Generate a real funded Stellar keypair. |
| Current admin is in auth lockout | `AuthLockedOut` | 5 | `transfer_admin` uses the non-rate-limited `require_admin` helper — lockout does **not** block it. If you receive this, double-check you are calling `transfer_admin`, not another admin function. |
| Contract is paused | *(no error)* | — | `transfer_admin` is not blocked by the pause flag. You can rotate while paused. |

### Unpause errors after rotation

| Scenario | Error | Code | What to do |
|----------|-------|------|------------|
| `pause_with_reason` was used and timelock active | `TimelockActive` | 72 | Wait for the 7-day timelock to expire, or use guardian early-unpause (section 8). |
| Guardian approvals < 3 | `InsufficientUnpauseSignatures` | 73 | Collect more guardian votes. |
| Guardian already voted | `AlreadyApprovedUnpause` | 74 | Wait for other guardians to vote. |
| Caller is not a guardian | `NotAPauseGuardian` | 75 | Only addresses registered via `set_pause_guardians` can vote. |

### Concurrent rotation attempts

There is no locking mechanism to prevent two operators from attempting
`transfer_admin` simultaneously. The first transaction to be included in a
ledger wins; the second will fail with `Unauthorized` because the admin has
already changed. Always confirm the transaction hash on Horizon before
declaring the rotation complete.

### Transfer to a funded-but-unregistered Stellar account

`transfer_admin` accepts any non-zero Stellar address, including accounts that
have never been funded. If the new admin account has no XLM balance, it cannot
sign transactions on the Stellar network. The contract will hold the address as
admin but no admin operations will be executable.

**Always verify the new admin address is funded and the key is accessible before
executing the transfer.**

### Re-transfer after mistake

If the wrong address was transferred to but the key is still accessible, call
`transfer_admin` again from the mistaken address to the correct one:

```bash
stellar contract invoke --id $CONTRACT_ID \
  --source-account "$WRONG_ADMIN_KEY" \
  --network $NETWORK \
  -- transfer_admin \
  --current_admin "$WRONG_ADMIN_ADDR" \
  --new_admin "$CORRECT_ADMIN_ADDR"
```

If the key for the mistaken address is **not** accessible, admin is permanently
lost — deploy a new contract instance (section 7).

---

## 11. Two-Person Integrity Checklist

All production key rotations must be witnessed. Both operators sign the
rotation log.

| Step | Operator 1 (Executor) | Operator 2 (Witness) |
|------|-----------------------|----------------------|
| New admin key generated and public address verified | ☐ | ☐ |
| New admin account funded (XLM balance confirmed) | ☐ | ☐ |
| `transfer_admin` command reviewed before execution | ☐ | ☐ |
| Transaction hash recorded | ☐ | ☐ |
| On-chain verification completed (new admin accepted, old rejected) | ☐ | ☐ |
| Contract unpaused and accepting payments | ☐ | ☐ |
| Old HSM device decommissioned | ☐ | ☐ |
| All secret stores updated | ☐ | ☐ |
| CI/CD secrets updated | ☐ | ☐ |
| Rotation log filed | ☐ | ☐ |

### Rotation log template

```
Date:              YYYY-MM-DD HH:MM UTC
Network:           mainnet | testnet
Old admin address: G...
New admin address: G...
Transaction hash:  <Stellar transaction ID>
Horizon event:     lumenflow/admin_transferred confirmed at ledger <N>
Executor:          [Name, role]
Witness:           [Name, role]
Reason:            Planned / Compromise / HSM failure / Personnel change
Contract paused:   Yes / No
Contract unpaused: Yes / No (if No, explain)
Notes:
```

Store the completed log in your organization's secure audit trail system.

---

## 12. Record Keeping

- All key rotation events must be logged with date, operator, witness,
  transaction hash, and reason.
- Logs must be retained for a minimum of 2 years.
- Update the following after every rotation:

| Record | What to update |
|--------|---------------|
| Internal secrets manager | New admin public address and secret key reference |
| CI/CD repository secrets | `TESTNET_ADMIN_KEY`, `TESTNET_ADMIN_ADDRESS` (testnet); equivalent mainnet secrets |
| Monitoring dashboards | Admin address in alert rules and Grafana annotations |
| On-call runbook | Pointer to the new admin contact and HSM location |
| Incident response plan | Updated admin key holder list |

---

## Related Documents

| Document | Purpose |
|----------|---------|
| [SECURITY.md](../SECURITY.md) | Responsible disclosure and incident response |
| [docs/auth-model.md](auth-model.md) | Complete auth table for all contract functions |
| [docs/access-control.md](access-control.md) | Storage access control model |
| [docs/deployment-guide.md](deployment-guide.md) | Contract deployment procedures |
| [docs/deployment-runbook.md](deployment-runbook.md) | Step-by-step deployment and verification runbook |
| [docs/secrets-and-local-env.md](secrets-and-local-env.md) | Secrets management and local credentials policy |
| [docs/monitoring.md](monitoring.md) | Horizon SSE, Prometheus, suspicious_activity alert setup |
