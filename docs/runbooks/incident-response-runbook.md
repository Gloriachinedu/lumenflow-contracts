# Incident Response Runbook

Operational, copy-paste runbook for a **confirmed security incident** on a
LumenFlow deployment. For the policy, roles, and disclosure workflow see
[Vulnerability Disclosure & Incident Response Workflow](../security/vulnerability-disclosure-and-incident-response.md).

> **First 15 minutes:** declare the incident, assign an Incident Commander (IC),
> open the incident log, and decide whether to pause. When in doubt about funds
> at risk — **pause first, investigate behind the timelock.**

Set these once at the start of the incident:

```bash
export CONTRACT_ID=<deployed-contract-id>
export ADMIN_KEY=<admin-secret>          # from HSM / secure store — never commit
export ADMIN_ADDR=<admin-public-key>
export NETWORK=mainnet                   # or testnet
export HORIZON=https://horizon.stellar.org
```

---

## 1. Declare

- [ ] IC named. Incident id: `LF-INC-YYYY-NNN`. Linked report: `LF-VDP-YYYY-NNN`.
- [ ] Incident log started (timestamped, UTC).
- [ ] War room / private channel opened. Guardians notified if Critical.
- [ ] Severity set (Critical / High / Medium / Low) per SECURITY.md scale.

---

## 2. Contain

### 2.1 Pause the contract (funds at risk / active exploit)

Use `pause_with_reason` for security incidents — it records the reason on-chain
and starts the 7-day unpause timelock:

```bash
stellar contract invoke --id "$CONTRACT_ID" --source-account "$ADMIN_KEY" --network "$NETWORK" \
  -- pause_with_reason \
  --admin "$ADMIN_ADDR" \
  --reason "LF-INC-YYYY-NNN: <one-line description>"
```

Confirm the pause is live:

```bash
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_contract_version
# Expect: error ContractPaused (70)
```

Verify the `contract_paused` event on Horizon:

```bash
curl -s "$HORIZON/contracts/$CONTRACT_ID/events?order=desc&limit=5" \
  | jq '.["_embedded"].records[] | select(.topic[1]=="contract_paused")'
```

### 2.2 Suspected key compromise

- [ ] Pause (2.1) immediately.
- [ ] Begin emergency admin-key rotation:
      [admin-key-rotation.md](../admin-key-rotation.md) → *Emergency rotation*.
- [ ] Treat every admin-signed action since the suspected compromise window as
      hostile; enumerate them from `admin_set` / privileged events.
- [ ] Rotate any leaked off-chain credentials (CI secrets, deploy keys, Horizon
      API keys, monitoring keys).

### 2.3 Off-chain / infra incident

- [ ] Revoke the affected credential or token.
- [ ] Rotate `.env` secrets; see [secrets-and-local-env.md](../secrets-and-local-env.md).
- [ ] Invalidate sessions / redeploy affected services.

---

## 3. Assess

- [ ] Exploit path confirmed (reproduced on **testnet/local only**).
- [ ] Blast radius: which deployments, which merchants, how many payments/refunds,
      total value exposed.
- [ ] On-chain impact quantified. Use the event replay tool for a full history:

```bash
CONTRACT_ID="$CONTRACT_ID" HORIZON_URL="$HORIZON" ./scripts/replay-events.sh
```

- [ ] Determine whether user funds were actually moved vs. only at risk.
- [ ] Snapshot relevant ledger state and events for the post-incident review.

---

## 4. Eradicate

- [ ] Fix developed on a **private** branch / GitHub security advisory fork.
- [ ] Independent review (Fix Owner ≠ reviewer).
- [ ] **Regression test added** + row in
      [regression-catalog.md](../security/regression-catalog.md) and
      `scripts/security-regression-check.sh`:

```bash
./scripts/security-regression-check.sh          # must pass, includes the new guard
cargo test --all-features
```

- [ ] WASM rebuilt and hash-verified:

```bash
make build
./scripts/verify-build.sh
sha256sum target/wasm32-unknown-unknown/release/lumenflow.wasm
```

---

## 5. Recover

> The contract must remain **paused** during the upgrade.

- [ ] Deploy the patched WASM (admin only):

```bash
stellar contract invoke --id "$CONTRACT_ID" --source-account "$ADMIN_KEY" --network "$NETWORK" \
  -- upgrade --admin "$ADMIN_ADDR" --new_wasm_hash <sha256-of-patched-wasm>
```

- [ ] Verify the new version:

```bash
stellar contract invoke --id "$CONTRACT_ID" --network "$NETWORK" -- get_contract_version
```

- [ ] Unpause — choose one:
  - **Standard:** wait for the 7-day timelock, then
    `unpause_contract --admin "$ADMIN_ADDR"`.
  - **Early (3-of-5 guardians):** each of 3 guardians runs
    `approve_early_unpause --guardian <their-addr>`; the contract unpauses on the
    third approval (`contract_unpaused` event carries `("multisig_override",)`).
- [ ] Confirm normal operation: monitoring green, a test payment on a canary
      merchant succeeds, no `suspicious_activity` events.

---

## 6. Disclose

- [ ] Advisory drafted (root cause without a working exploit) — see workflow §5.
- [ ] Advisory published **after** the fix is live.
- [ ] `CHANGELOG.md` `### Security` entry added.
- [ ] Reporter credited / bounty processed.
- [ ] Affected users notified via the announcement channel.

---

## 7. Post-incident review

- [ ] Blameless review within 5 business days (workflow §6).
- [ ] Action items filed with owners and dates.
- [ ] Threat model / monitoring / runbook updated as needed.
- [ ] Scoped re-audit opened if contract logic changed materially
      ([audit-engagement-plan.md §7](../audit/audit-engagement-plan.md#7-re-audit-triggers)).

---

## Quick reference

| Need | Command / doc |
|------|---------------|
| Pause (incident) | `pause_with_reason --admin $ADMIN_ADDR --reason "..."` |
| Pause (maintenance) | `pause_contract --admin $ADMIN_ADDR` |
| Early unpause | 3× `approve_early_unpause --guardian <addr>` |
| Register guardians (do this **before** an incident) | `set_pause_guardians --admin $ADMIN_ADDR --guardians '[...]'` |
| Key rotation | [admin-key-rotation.md](../admin-key-rotation.md) |
| Event history / impact | `./scripts/replay-events.sh` |
| Build verification | `./scripts/verify-build.sh` |
| Regression gate | `./scripts/security-regression-check.sh` |
| Monitoring | [monitoring.md](../monitoring.md) |
