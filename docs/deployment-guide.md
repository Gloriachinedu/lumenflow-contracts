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

---

## Blue-Green Deployment Strategy

Blue-green deployment runs **two full contract instances** — blue and green — in parallel. The router holds a single `ActiveSlot` value and sends **100% of traffic** to whichever slot is active. Cutover is an atomic single-ledger write; rollback is the identical operation in reverse.

```
blue contract   ←── 100% (active)    ┐
                                      │  router contract  ←── all calls
green contract  ←── 0%  (standby)  ──┘
```

No traffic is ever split between the two slots during a cutover. The switch is all-or-nothing within one Soroban ledger.

---

### When to use blue-green vs canary

| Criterion | Blue-Green | Canary |
|-----------|-----------|--------|
| Downtime | Zero — atomic switch | Near-zero — gradual ramp |
| Traffic split | 0% / 100% only | Configurable 0–100% |
| Best for | Breaking changes, large upgrades | Low-risk patches, gradual validation |
| Rollback time | Instant (one ledger write) | Requires weight adjustment |
| Cost | Two live contract deployments at all times | One extra contract only during eval |

---

### Prerequisites

- Router contract deployed and admin set (see [Router contract](#router-contract) below).
- Blue slot and green slot contracts both deployed and admin-initialised.
- `ROUTER_CONTRACT_ID`, `SOURCE_ACCOUNT`, and `ADMIN_ADDRESS` available as environment variables.

---

### Step-by-step: initial setup

#### 1. Deploy the router contract

```bash
cargo build --target wasm32-unknown-unknown --release --package lumenflow-router
stellar contract deploy \
  --wasm target/wasm32-unknown-unknown/release/lumenflow_router.wasm \
  --source-account $SOURCE_ACCOUNT \
  --network $NETWORK
# → prints ROUTER_CONTRACT_ID
```

Initialise the router admin:

```bash
stellar contract invoke \
  --id $ROUTER_CONTRACT_ID \
  --source-account $SOURCE_ACCOUNT \
  --network $NETWORK \
  -- set_admin --admin $ADMIN_ADDRESS
```

#### 2. Deploy the blue contract (current stable code)

```bash
NETWORK=$NETWORK SOURCE_ACCOUNT=$SOURCE_ACCOUNT ./scripts/deploy.sh
# → prints BLUE_CONTRACT_ID
```

Initialise the blue admin:

```bash
stellar contract invoke \
  --id $BLUE_CONTRACT_ID \
  --source-account $SOURCE_ACCOUNT \
  --network $NETWORK \
  -- set_admin --admin $ADMIN_ADDRESS
```

Register blue with the router:

```bash
stellar contract invoke \
  --id $ROUTER_CONTRACT_ID \
  --source-account $SOURCE_ACCOUNT \
  --network $NETWORK \
  -- set_blue_contract --admin $ADMIN_ADDRESS --blue_id $BLUE_CONTRACT_ID
```

#### 3. Deploy the green contract (new code)

```bash
NETWORK=$NETWORK SOURCE_ACCOUNT=$SOURCE_ACCOUNT ./scripts/deploy.sh
# → prints GREEN_CONTRACT_ID
```

Initialise the green admin:

```bash
stellar contract invoke \
  --id $GREEN_CONTRACT_ID \
  --source-account $SOURCE_ACCOUNT \
  --network $NETWORK \
  -- set_admin --admin $ADMIN_ADDRESS
```

Register green with the router:

```bash
stellar contract invoke \
  --id $ROUTER_CONTRACT_ID \
  --source-account $SOURCE_ACCOUNT \
  --network $NETWORK \
  -- set_green_contract --admin $ADMIN_ADDRESS --green_id $GREEN_CONTRACT_ID
```

#### 4. Validate the standby slot

Run the smoke test directly against the green contract **before** cutting over:

```bash
CONTRACT_ID=$GREEN_CONTRACT_ID \
ADMIN_KEY=$ADMIN_KEY \
MERCHANT_KEY=$MERCHANT_KEY \
PAYER_KEY=$PAYER_KEY \
TOKEN_ADDRESS=$TOKEN_ADDRESS \
ADMIN_ADDRESS=$ADMIN_ADDRESS \
MERCHANT_ADDRESS=$MERCHANT_ADDRESS \
PAYER_ADDRESS=$PAYER_ADDRESS \
NETWORK=$NETWORK \
./scripts/smoke_test.sh
```

Do not proceed to cutover until the smoke test exits 0.

#### 5. Perform the atomic cutover

```bash
NETWORK=$NETWORK \
SOURCE_ACCOUNT=$SOURCE_ACCOUNT \
ROUTER_CONTRACT_ID=$ROUTER_CONTRACT_ID \
ADMIN_ADDRESS=$ADMIN_ADDRESS \
TARGET_SLOT=green \
./scripts/cutover.sh
```

The script queries and records the current active slot to `blue-green-previous-slot.txt`, verifies the green contract is configured, then calls `set_active_slot(Green)` on the router in one ledger write.

#### 6. Verify after cutover

```bash
# Confirm the active slot
stellar contract invoke \
  --id $ROUTER_CONTRACT_ID \
  --source-account $SOURCE_ACCOUNT \
  --network $NETWORK \
  -- get_active_slot

# Re-run smoke test against the live contract
CONTRACT_ID=$GREEN_CONTRACT_ID NETWORK=$NETWORK ./scripts/smoke_test.sh
```

Monitor `lumenflow/routed_to_green` events from the router via Horizon SSE (see [docs/monitoring.md](monitoring.md)).

---

### Rolling back a blue-green cutover

If the green contract shows elevated error rates or unexpected behaviour after cutover, roll back in a single command:

```bash
NETWORK=$NETWORK \
SOURCE_ACCOUNT=$SOURCE_ACCOUNT \
ROUTER_CONTRACT_ID=$ROUTER_CONTRACT_ID \
ADMIN_ADDRESS=$ADMIN_ADDRESS \
./scripts/rollback.sh
```

The script resolves the previous slot from `blue-green-previous-slot.txt` (written by `cutover.sh`), verifies the slot is configured, and calls `set_active_slot` with the previous slot — identical mechanics to the forward cutover.

To force rollback to a specific slot:

```bash
ROLLBACK_TO_SLOT=blue \
NETWORK=$NETWORK \
SOURCE_ACCOUNT=$SOURCE_ACCOUNT \
ROUTER_CONTRACT_ID=$ROUTER_CONTRACT_ID \
ADMIN_ADDRESS=$ADMIN_ADDRESS \
./scripts/rollback.sh
```

After rollback:
1. Run the smoke test against the restored contract.
2. Investigate the failure on the abandoned slot before re-attempting cutover.
3. The abandoned contract remains deployed on-chain (Soroban contracts are immutable). It can be queried for diagnostics but must not be used in production.

---

### Router contract

The router contract lives in `contracts/router/`. It supports both blue-green and canary strategies through a unified `route_call` function.

**Blue-green routing** (default when `CANARY_WEIGHT = 0`):

```text
active_slot = storage[ACTIVE_SLOT]   (default: Blue)
if active_slot == Blue   →  return blue contract address
if active_slot == Green  →  return green contract address
```

**Canary routing** (when `CANARY_WEIGHT > 0`):

```text
bucket = ledger_sequence mod 100
if bucket < canary_weight  →  return canary contract address
else                       →  return stable contract address
```

When both strategies are configured, a non-zero `CANARY_WEIGHT` takes precedence over blue-green routing.

**Key router functions:**

| Function | Description |
|----------|-------------|
| `set_admin(admin)` | Initialise or rotate the router admin |
| `set_blue_contract(admin, blue_id)` | Register the blue-slot contract |
| `set_green_contract(admin, green_id)` | Register the green-slot contract |
| `set_active_slot(admin, slot)` | **Atomic cutover** — switch active slot |
| `get_active_slot()` | Query which slot is currently active |
| `get_blue_contract()` | Read the configured blue contract address |
| `get_green_contract()` | Read the configured green contract address |
| `route_call()` | Determine and return the address for the current call |
| `set_canary_weight(admin, weight)` | Enable/disable canary routing (0 = off) |
| `set_canary_contract(admin, canary_id)` | Register the canary contract |
| `set_stable_contract(admin, stable_id)` | Register the stable contract (canary mode) |

---

### Events emitted by the router

| Event topic pair | Data | Description |
|-----------------|------|-------------|
| `("lumenflow", "routed_to_blue")` | ledger sequence | Call directed to blue slot |
| `("lumenflow", "routed_to_green")` | ledger sequence | Call directed to green slot |
| `("lumenflow", "blue_green_cutover")` | new Slot enum | Active slot changed |
| `("lumenflow", "routed_to_canary")` | ledger sequence | Call directed to canary |
| `("lumenflow", "routed_to_stable")` | ledger sequence | Call directed to stable (canary mode) |

Subscribe to these events via Horizon SSE to monitor routing in real time. See [docs/monitoring.md](monitoring.md) for subscription examples.

---

### Blue-green deployment checklist

**Before cutover:**
- [ ] Green contract deployed and admin initialised
- [ ] Green contract registered with router (`set_green_contract`)
- [ ] Smoke test passes against green contract directly
- [ ] Runbook (this document) reviewed by on-call engineer
- [ ] Rollback path (`./scripts/rollback.sh`) verified end-to-end on testnet

**During cutover:**
- [ ] `cutover.sh` exits 0
- [ ] `get_active_slot` returns the expected new slot
- [ ] Router emits `blue_green_cutover` event on-chain

**After cutover:**
- [ ] Smoke test passes against the new active contract
- [ ] Horizon event stream shows `routed_to_<new_slot>` events
- [ ] No elevated error rate in monitoring dashboards
- [ ] SDK / frontend / CI `CONTRACT_ID` references updated

**Key considerations:**

| Topic | Detail |
|-------|--------|
| Contract immutability | Soroban contracts cannot be modified or deleted. Both slots remain on-chain after cutover. |
| Historical data | Payments processed on the old slot remain queryable against its contract ID. |
| Partial state | Cutover is atomic within one ledger. There is no partial-state window. |
| Key management | Use the same admin key for blue and green. Do not reuse testnet keys on mainnet. |
| Rollback scope | Rolling back changes the active slot only. It does not undo payments already processed by the new slot during the window between cutover and rollback. |
