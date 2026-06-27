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
