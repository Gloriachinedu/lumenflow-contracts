# Deployment Guide

This guide covers deploying LumenFlow to testnet and mainnet, including pre-deployment checks, security considerations, post-deployment verification, and rollback strategy.

---

## Pre-Deployment Checklist

Before deploying to any network, confirm the following:

- [ ] Rust stable toolchain installed (`rustc --version`)
- [ ] `wasm32-unknown-unknown` target added (`rustup target add wasm32-unknown-unknown`)
- [ ] Stellar CLI installed (`stellar --version`)
- [ ] All tests pass: `cargo test --all-features`
- [ ] WASM binary builds cleanly: `cargo build --target wasm32-unknown-unknown --release --package lumenflow`
- [ ] Binary size is under 100 KB: `wc -c target/wasm32-unknown-unknown/release/lumenflow.wasm`
- [ ] Deployer account is funded (XLM for fees)
- [ ] Admin address is a dedicated key — not the same as the deployer
- [ ] Admin secret key is stored securely (hardware wallet or secrets manager for mainnet)
- [ ] You have noted the intended `CONTRACT_ID` storage location for your team

---

## Testnet Walkthrough

### 1. Validate Docker Compose and fund your account

Before starting a local network, validate the compose file and confirm there are no syntax issues:

```bash
docker compose -f docker-compose.yml config
```

This command ensures the manifest is complete and that Docker Compose can parse it successfully.

Use a local `.env` file or runtime environment variables for secrets and credentials. Do not hardcode private keys, secret values, or network credentials in repository files.

```bash
curl "https://friendbot.stellar.org?addr=<YOUR_PUBLIC_KEY>"
```

### 2. Build and deploy

```bash
NETWORK=testnet SOURCE_ACCOUNT=<testnet-secret-key> ./scripts/deploy.sh
```

The script prints the `CONTRACT_ID` on success. Save it.

### 3. Initialise the admin

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret-key> \
  --network testnet \
  -- set_admin --admin <admin-address>
```

`set_admin` can only be called once. The address you provide becomes the permanent admin.

### 4. Register a test merchant

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <merchant-secret-key> \
  --network testnet \
  -- register_merchant \
  --merchant_address <merchant-address> \
  --name "Test Store" \
  --description "Testnet merchant" \
  --contact_info "test@example.com" \
  --category Retail
```

### 5. Run the smoke test

```bash
CONTRACT_ID=<id> \
ADMIN_KEY=<admin-secret> \
MERCHANT_KEY=<merchant-secret> \
PAYER_KEY=<payer-secret> \
TOKEN_ADDRESS=<sac-token-address> \
ADMIN_ADDRESS=<admin-address> \
MERCHANT_ADDRESS=<merchant-address> \
PAYER_ADDRESS=<payer-address> \
NETWORK=testnet \
./scripts/smoke_test.sh
```

A zero exit code means the contract is functional.

---

## Mainnet Walkthrough

### Security notes

- **Never reuse testnet keys on mainnet.** Generate fresh keypairs.
- Store the admin secret key in a hardware wallet or a secrets manager (e.g., AWS Secrets Manager, HashiCorp Vault). Do not commit it to source control.
- Do not hardcode secrets in repository files or Docker Compose manifests.
- Use `.env`-style files, OS environment variables, or platform secret stores for local development.
- The deployer account only needs enough XLM to cover the deployment fee. Fund it minimally and rotate the key after deployment.
- `set_admin` is irreversible — double-check the admin address before invoking it.
- Enable Stellar account thresholds and multi-sig on the admin account for additional protection.

### Local secret handling

For local Docker Compose runs, store sensitive values in a local `.env` file that is excluded by `.gitignore`. Example:

```bash
cp .env.example .env.local
```

Then set secrets locally:

```bash
export SOURCE_ACCOUNT="S..."
export ADMIN_KEY="S..."
```

Avoid committing `.env.local` or any files that contain real secret keys.

### 1. Generate and fund a mainnet deployer account

Acquire XLM from an exchange and send it to your deployer public key. Verify the balance:

```bash
stellar account show --account <deployer-public-key> --network mainnet
```

### 2. Build and deploy

```bash
NETWORK=mainnet SOURCE_ACCOUNT=<mainnet-deployer-secret> ./scripts/deploy.sh
```

Save the printed `CONTRACT_ID` immediately. Share it with your team through a secure channel.

### 3. Initialise the admin

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret-key> \
  --network mainnet \
  -- set_admin --admin <admin-address>
```

### 4. Configure the payment cleanup period (optional)

Default is 90 days (7 776 000 seconds). Adjust if needed:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret-key> \
  --network mainnet \
  -- set_payment_cleanup_period --admin <admin-address> --period 7776000
```

### 5. Run the smoke test against mainnet

Use the same smoke test script with `NETWORK=mainnet` and real mainnet keys. Use a minimal token amount (e.g., 1 stroop) for the test payment.

---

## Post-Deployment Verification

After deploying to either network, verify the contract is live and correctly initialised:

```bash
# Confirm admin is set (should return the admin address)
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <any-key> \
  --network <NETWORK> \
  -- get_global_payment_stats \
  --admin <admin-address> \
  --date_start null \
  --date_end null
```

- Confirm the smoke test exits 0.
- Check Stellar Explorer (testnet: https://testnet.steexp.com, mainnet: https://steexp.com) for the deployment transaction.
- Set up event monitoring via Horizon SSE — see [docs/monitoring.md](monitoring.md).

---

## Rollback Strategy

Soroban contracts are immutable once deployed. There is no in-place upgrade path. The rollback procedure is:

1. **Deploy a new contract** with the corrected code using `./scripts/deploy.sh`.
2. **Initialise the new contract** (`set_admin`, merchant re-registration, etc.).
3. **Update all integrations** (SDK config, frontend, webhooks) to point to the new `CONTRACT_ID`.
4. **Deactivate merchants** on the old contract via `deactivate_merchant` to prevent new payments.
5. **Archive or document** the old `CONTRACT_ID` so historical payment records remain queryable during the transition window.

To minimise downtime, prepare the new contract in parallel before switching traffic.

---

## Canary Deployment Strategy

Soroban contracts are immutable once deployed. A canary deployment works by deploying a **new contract instance** (the canary) alongside the existing **stable** contract, then using a router contract to split live traffic between them before committing to a full cutover.

### Overview

```
stable contract  ←──95%──┐
                          │  router contract  ←── all incoming calls
canary contract  ←── 5%──┘
```

1. **Deploy canary** — a new contract instance built from the updated code.
2. **Configure router** — point the router at both stable and canary, set weight to 5%.
3. **Monitor** — compare error rates and latency between stable and canary via Horizon event streaming (see [docs/monitoring.md](monitoring.md)).
4. **Promote or roll back** — if the canary is healthy, promote it to stable; otherwise roll back.

---

### Deploy a canary

```bash
NETWORK=testnet SOURCE_ACCOUNT=<deployer-secret> ./scripts/deploy-canary.sh
```

The script:
- Builds the WASM from the current source tree.
- Deploys a new contract instance and prints the `CANARY_CONTRACT_ID`.
- Writes the canary ID to `canary-contract-id.txt` in the workspace root.
- Prints next-step instructions for configuring the router and monitoring.

After deploying, initialise the canary admin and register it with the router:

```bash
# 1. Initialise admin on the canary
stellar contract invoke \
  --id <CANARY_CONTRACT_ID> \
  --source-account $SOURCE_ACCOUNT \
  --network testnet \
  -- set_admin --admin <ADMIN_ADDRESS>

# 2. Register the canary in the router
stellar contract invoke \
  --id $ROUTER_CONTRACT_ID \
  --source-account $SOURCE_ACCOUNT \
  --network testnet \
  -- set_canary_contract --admin <ADMIN_ADDRESS> --canary_id <CANARY_CONTRACT_ID>

# 3. Set traffic weight (default is already 5%)
stellar contract invoke \
  --id $ROUTER_CONTRACT_ID \
  --source-account $SOURCE_ACCOUNT \
  --network testnet \
  -- set_canary_weight --admin <ADMIN_ADDRESS> --weight 5
```

---

### Router contract

The router contract lives in `contracts/router/`. It holds two addresses (stable and canary) and a `CANARY_WEIGHT` value (0–100, default: 5). For each call the router evaluates:

```
bucket = ledger_sequence_number mod 100
if bucket < canary_weight  →  forward to canary
else                       →  forward to stable
```

The ledger sequence is monotonically increasing and cycles through all 100 buckets evenly, so a weight of 5 routes approximately 5% of calls to the canary without any off-chain randomness source.

To deploy the router:

```bash
cargo build --target wasm32-unknown-unknown --release --package lumenflow-router
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/lumenflow_router.wasm \
  --source-account $SOURCE_ACCOUNT \
  --network testnet
```

---

### Monitor error rates

Subscribe to `lumenflow/routed_to_canary` and `lumenflow/routed_to_stable` events from the router, plus the standard `lumenflow/payment_processed` events from both contracts. Compare:

- Error rate (failed invocations / total calls)
- Latency (Horizon response times)
- Refund and payment anomalies

For detailed Horizon SSE subscription guidance see [docs/monitoring.md](monitoring.md).

---

### Promote a canary

Once the canary has processed sufficient traffic without elevated errors:

```bash
NETWORK=testnet ./scripts/promote-canary.sh
```

The script:
- Reads `CANARY_CONTRACT_ID` from `canary-contract-id.txt` (or `$CANARY_CONTRACT_ID` env var).
- Overwrites `testnet-contract-id.txt` with the canary ID, making it the new stable.
- Clears `canary-contract-id.txt`.
- Prints a post-promotion checklist.

After promotion, set the router weight to 0 to disable canary routing and update all SDK / frontend / CI references to the new `CONTRACT_ID`.

---

### Roll back a canary

If the canary shows elevated error rates or unexpected behaviour:

```bash
NETWORK=testnet ./scripts/rollback-canary.sh
```

The script:
- Reads the previous stable ID from `stable-contract-id.txt` or `$STABLE_CONTRACT_ID`.
- Restores `testnet-contract-id.txt` to the previous stable ID.
- Clears `canary-contract-id.txt`.
- Prints a post-rollback checklist including smoke test instructions.

Set the router weight back to 0 to stop sending traffic to the canary:

```bash
stellar contract invoke \
  --id $ROUTER_CONTRACT_ID \
  --source-account $SOURCE_ACCOUNT \
  --network testnet \
  -- set_canary_weight --admin <ADMIN_ADDRESS> --weight 0
```

The abandoned canary contract remains deployed on-chain. It can be queried for diagnostic purposes but should not be used in production.

---

### Key considerations

| Topic | Detail |
|-------|--------|
| Contract immutability | Soroban contracts cannot be modified or deleted after deployment. Both stable and canary remain on-chain indefinitely. |
| Historical data | Payments made against the canary during the evaluation window remain queryable on the canary contract ID. |
| Router dependency | Traffic splitting requires the router contract to be deployed and configured. Without a router, all traffic goes to the stable contract. |
| Key management | Use the same admin key for stable and canary. Do not use testnet keys on mainnet. |
| Rollback scope | Rolling back reverts the canonical contract ID only. It does not undo payments already processed by the canary. |
