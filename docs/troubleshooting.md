# LumenFlow Troubleshooting Guide

This guide documents common errors encountered when building, deploying, running, and upgrading LumenFlow smart contracts on Soroban/Stellar. Each entry includes the cause, symptoms, and resolution steps.

For contract-level error codes, see [`docs/errors.md`](errors.md).  
To submit a new error entry, open a PR using the [troubleshooting issue template](../.github/ISSUE_TEMPLATE/troubleshooting_entry.yml).

---

## Table of Contents

- [Build Errors](#build-errors)
- [Deploy Errors](#deploy-errors)
- [Runtime Errors](#runtime-errors)
- [Upgrade Errors](#upgrade-errors)

---

## Build Errors

### B-01 — WASM target not installed

**Cause:** The `wasm32-unknown-unknown` target has not been added to the active Rust toolchain.

**Symptoms:**
```
error[E0463]: can't find crate for `core`
error: cannot find crate for `std`
```

**Resolution:**
```bash
rustup target add wasm32-unknown-unknown
```

---

### B-02 — Rust toolchain version mismatch

**Cause:** The installed Rust toolchain does not match the version pinned in `rust-toolchain.toml`.

**Symptoms:**
```
error: override file '/workspaces/lumenflow-contracts/rust-toolchain.toml' specifies channel 'stable' but installed toolchain is ...
```

**Resolution:**
```bash
rustup update stable
rustup override set stable
```

Verify the channel in `rust-toolchain.toml` matches:
```bash
cat rust-toolchain.toml
```

---

### B-03 — `soroban-sdk` version mismatch

**Cause:** The `soroban-sdk` version in `contracts/lumenflow/Cargo.toml` is incompatible with the active Rust/Soroban toolchain.

**Symptoms:**
```
error[E0308]: mismatched types
error: failed to select a version for the requirement `soroban-sdk = "^X.Y"`
```

**Resolution:** Align the SDK version with the Stellar CLI and toolchain:
```bash
# Check your Stellar CLI version
stellar --version
# Update Cargo.toml to the matching soroban-sdk version, then:
cargo update
```

See the [Soroban compatibility matrix](https://developers.stellar.org/docs/tools/sdks/library-sdk).  
Related error: [`InvalidInput` (50)](errors.md#50)

---

### B-04 — `cargo clippy` fails with warnings-as-errors

**Cause:** The CI pipeline runs `cargo clippy -- -D warnings`. Any clippy lint is treated as a hard error.

**Symptoms:**
```
error: this expression creates a reference which is immediately dereferenced by the compiler
```

**Resolution:** Fix the reported lint, or if it is a false positive, suppress it explicitly:
```rust
#[allow(clippy::needless_borrow)]
```

---

### B-05 — `cargo fmt` check fails

**Cause:** Code formatting does not match `rustfmt` defaults. CI runs `cargo fmt --all -- --check`.

**Symptoms:**
```
Diff in contracts/lumenflow/src/lib.rs:
...
```

**Resolution:**
```bash
cargo fmt --all
```

Then commit the formatted files.

---

### B-06 — WASM binary exceeds contract size limit

**Cause:** Soroban enforces a maximum contract WASM size (~128 KB). Adding large dependencies or inlining too much code can breach this.

**Symptoms:**
```
error: WasmInvalidImport
```
or the deploy step rejects the binary.

**Resolution:**
- Enable `opt-level = "z"` and `lto = true` in the `[profile.release]` section of `Cargo.toml`.
- Remove unused features from dependencies (`default-features = false`).
- Run `wasm-opt -Oz` on the produced `.wasm` file.

---

### B-07 — Missing `#![no_std]` attribute

**Cause:** The contract crate inadvertently pulls in `std`, which is unsupported in a WASM Soroban contract.

**Symptoms:**
```
error[E0433]: failed to resolve: use of undeclared crate or module `std`
```

**Resolution:** Ensure `lib.rs` begins with:
```rust
#![no_std]
```
and replace any `std` imports with `soroban_sdk` equivalents.

---

## Deploy Errors

### D-01 — RPC timeout during contract upload

**Cause:** The Stellar RPC node is overloaded or unreachable. Large WASM uploads are particularly susceptible on congested networks.

**Symptoms:**
```
Error: RPC request timed out after 30s
```

**Resolution:**
1. Retry with an exponential back-off:
   ```bash
   stellar contract upload --wasm target/wasm32-unknown-unknown/release/lumenflow.wasm \
     --rpc-url https://soroban-testnet.stellar.org --network-passphrase "Test SDF Network ; September 2015"
   ```
2. Try an alternative public RPC endpoint.
3. Increase the CLI timeout via the `STELLAR_RPC_TIMEOUT` environment variable (if supported by your CLI version).

---

### D-02 — Insufficient XLM for transaction fees

**Cause:** The deploying account's XLM balance is too low to cover the resource fees for uploading and instantiating the contract.

**Symptoms:**
```
Error: insufficient balance
```
or  
`InsufficientBalance` (error code [25](errors.md#25))

**Resolution:**
- **Testnet:** Fund via [Friendbot](https://friendbot.stellar.org/?addr=YOUR_ADDRESS).
- **Mainnet:** Transfer XLM to the deployer account before running `deploy.sh`.

---

### D-03 — Friendbot rate limit exceeded

**Cause:** Friendbot enforces a per-address and per-IP rate limit. Multiple rapid requests hit the cap.

**Symptoms:**
```
{"detail":"Please try again later."}
```

**Resolution:**
- Wait 60 seconds and retry.
- Use a different address for each test run, or pre-fund a pool of test accounts.
- For CI, fund accounts once in a setup step and reuse them across tests.

---

### D-04 — WASM hash mismatch after re-upload

**Cause:** The contract was re-compiled (even without source changes) and the resulting WASM hash differs from the previously deployed hash stored on-chain.

**Symptoms:**
```
Error: contract hash mismatch
```

**Resolution:**
- Always use `--ignore-checks` only if you are certain of the binary identity.
- Use deterministic builds: pin the Rust toolchain (`rust-toolchain.toml`) and all dependency versions (`Cargo.lock`) so the same source always produces the same WASM.
- Verify the hash before deploying:
  ```bash
  sha256sum target/wasm32-unknown-unknown/release/lumenflow.wasm
  ```

---

### D-05 — `AdminAlreadySet` on re-deploy

**Cause:** Calling `set_admin` on a contract that already has an admin stored in persistent storage. Error code [2](errors.md#2).

**Symptoms:**
```
Error: AdminAlreadySet (2)
```

**Resolution:** `set_admin` is a one-time initialisation call. If you need to change the admin, implement or call an upgrade/migration path. For fresh testnet deploys, deploy a new contract instance and call `set_admin` on it.

---

### D-06 — Docker local network fails to start

**Cause:** Docker Desktop is not running, or the Stellar container image is not pulled.

**Symptoms:**
```
Error response from daemon: No such container: stellar
stellar network container start local: exit status 1
```

**Resolution:**
```bash
# Ensure Docker is running, then:
stellar network container start local
# If the container already exists in a bad state:
stellar network container stop local
stellar network container start local
# Or restart:
stellar network container restart local
```

---

### D-07 — `SOURCE_ACCOUNT` secret key invalid

**Cause:** The `SOURCE_ACCOUNT` environment variable passed to `deploy.sh` is not a valid Stellar secret key (S…).

**Symptoms:**
```
Error: invalid source account
```

**Resolution:**
```bash
# Generate a new keypair for local/testnet use:
stellar keys generate --network testnet my-deployer
stellar keys show my-deployer
export SOURCE_ACCOUNT=$(stellar keys show my-deployer --secret-key)
```

---

## Runtime Errors

### R-01 — `Unauthorized` when calling admin functions

**Cause:** The caller's address does not match the stored admin address. Error code [1](errors.md#1).

**Symptoms:**
```
Error: Unauthorized (1)
```

**Resolution:**
- Verify you are signing with the correct admin key:
  ```bash
  stellar contract invoke ... --source-account $ADMIN_KEY -- get_merchant ...
  ```
- Confirm the admin address stored on chain:
  ```bash
  stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY --network $NETWORK \
    -- get_global_payment_stats --admin <expected-admin>
  ```

---

### R-02 — `MerchantNotFound` on payment

**Cause:** The merchant address passed to `process_payment_with_signature` has not been registered, or was deactivated. Error code [10](errors.md#10).

**Symptoms:**
```
Error: MerchantNotFound (10)
```

**Resolution:**
```bash
# Check if merchant is registered
stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY --network $NETWORK \
  -- get_merchant --merchant_address <address>
# If not found, register first:
stellar contract invoke ... -- register_merchant ...
```

---

### R-03 — `InvalidSignature` on payment

**Cause:** The ed25519 signature passed to `process_payment_with_signature` does not verify against the merchant's public key and the payment payload. Error code [23](errors.md#23).

**Symptoms:**
```
Error: InvalidSignature (23)
```

**Resolution:**
- Ensure the signature covers the correct payload (order_id + amount + merchant_address).
- Use the merchant's ed25519 **private** key to sign and the corresponding **public** key in the call.
- Verify byte ordering — Stellar uses big-endian 32-byte keys.

---

### R-04 — `PaymentAlreadyExists` — duplicate order ID

**Cause:** An order with the same `order_id` was already processed successfully. Error code [21](errors.md#21).

**Symptoms:**
```
Error: PaymentAlreadyExists (21)
```

**Resolution:** Use unique order IDs per transaction. Include a timestamp or UUID:
```js
const orderId = `ORDER_${Date.now()}_${crypto.randomUUID()}`;
```

---

### R-05 — `RefundWindowExpired`

**Cause:** More than 30 days have elapsed since `paid_at` for the payment. Error code [32](errors.md#32).

**Symptoms:**
```
Error: RefundWindowExpired (32)
```

**Resolution:** Refunds must be initiated within 30 days. Communicate this policy to customers at checkout. There is no on-chain override; the window is enforced by the contract.

---

### R-06 — `RefundExceedsOriginal` — over-refund attempt

**Cause:** The cumulative refund amount for an order would exceed the original payment amount. Error code [33](errors.md#33).

**Symptoms:**
```
Error: RefundExceedsOriginal (33)
```

**Resolution:** Track the already-refunded amount off-chain and ensure each refund request is for `original_amount - already_refunded`.

---

### R-07 — `InsufficientSignatures` on multisig payment

**Cause:** `execute_multisig_payment` was called before the required number of signers had signed. Error code [43](errors.md#43).

**Symptoms:**
```
Error: InsufficientSignatures (43)
```

**Resolution:** Check the current signature count before executing:
```bash
stellar contract invoke ... -- get_multisig_payment --payment_id "MS_001"
```
Wait for the remaining signers to call `sign_multisig_payment`.

---

### R-08 — `PaginationLimitExceeded` on history query

**Cause:** The `limit` parameter exceeds 100 (the maximum allowed). Error code [51](errors.md#51).

**Symptoms:**
```
Error: PaginationLimitExceeded (51)
```

**Resolution:** Use cursor-based pagination with `limit ≤ 100`:
```bash
# Page 1
stellar contract invoke ... -- get_merchant_payment_history \
  --merchant <addr> --cursor null --limit 100 ...
# Page 2 — use the last order_id from page 1 as the cursor
stellar contract invoke ... -- get_merchant_payment_history \
  --merchant <addr> --cursor "LAST_ORDER_ID" --limit 100 ...
```

---

### R-09 — `MerchantInactive` after deactivation

**Cause:** An admin has deactivated the merchant. Payments and new refunds for inactive merchants are rejected. Error code [12](errors.md#12).

**Symptoms:**
```
Error: MerchantInactive (12)
```

**Resolution:** Contact your platform admin to re-activate the merchant account, or register a new merchant address.

---

### R-10 — `PaymentExpired` — cleanup window passed

**Cause:** The payment record has been cleaned up by `cleanup_expired_payments` after the configured cleanup period. Error code [24](errors.md#24).

**Symptoms:**
```
Error: PaymentExpired (24)
```

**Resolution:** Archive payments proactively before they expire, or increase the cleanup period:
```bash
stellar contract invoke ... -- set_payment_cleanup_period --admin <admin> --period 15552000
```

---

### R-11 — RPC `HostError` / simulation failure

**Cause:** The transaction simulation step (run before submission) encountered a contract trap, such as a panic or an out-of-bounds ledger access.

**Symptoms:**
```
HostError: Error(Contract, #X)
```

**Resolution:**
- Enable `RUST_BACKTRACE=1` and re-run.
- Check the Soroban diagnostic events in the response for the precise error code.
- Cross-reference the code with [`error.rs`](../contracts/lumenflow/src/error.rs).

---

## Upgrade Errors

### U-01 — Storage schema migration required after upgrade

**Cause:** A contract upgrade changes the layout of a persistent storage key. Old data is read with a new type, causing a deserialization panic.

**Symptoms:**
```
HostError: Error(Value, InvalidInput)
```

**Resolution:**
- Write an explicit migration function before deploying the new WASM.
- Use versioned storage keys (e.g., `DataKey::MerchantV2`) and migrate data lazily on first access.
- Test upgrades on a testnet fork with production data snapshots before mainnet.

---

### U-02 — `wasm-opt` not found during release pipeline

**Cause:** The release workflow calls `wasm-opt` for binary optimisation but the tool is not installed in the CI runner.

**Symptoms:**
```
/bin/sh: wasm-opt: command not found
```

**Resolution:** Add a step to install `binaryen` before the build step in the workflow:
```yaml
- name: Install binaryen
  run: |
    sudo apt-get update && sudo apt-get install -y binaryen
```

---

### U-03 — Contract ID changes after re-deploy instead of upgrade

**Cause:** Running `stellar contract deploy` creates a **new** contract instance. Existing integrations pointing to the old contract ID break.

**Symptoms:** Old clients receive `PaymentNotFound` or `MerchantNotFound` because they are talking to an empty contract.

**Resolution:** Use `stellar contract upload` (to upload new WASM) followed by the upgrade mechanism of the existing contract, not a fresh deploy. Keep the contract ID stable.

---

### U-04 — Re-audit required after critical finding remediation

**Cause:** A critical security finding was patched, requiring a re-audit before the new WASM can be deployed to mainnet.

**Symptoms:** Mainnet deployment is blocked by the audit policy in [`docs/audit/`](audit/).

**Resolution:** Engage the audit firm for a targeted re-review of the changed functions. Do **not** deploy to mainnet until the re-audit sign-off is received. See [`docs/audit/audit-report-v1.0.md`](audit/audit-report-v1.0.md).

---

## Contributing New Entries

Found an error not listed here? Please open a PR using the [troubleshooting entry template](../.github/ISSUE_TEMPLATE/troubleshooting_entry.yml) and follow the format:

```markdown
### X-NN — Short error title

**Cause:** What causes this.

**Symptoms:**
\```
Error message or log output
\```

**Resolution:** How to fix it.
```

Link to the relevant error code in [`docs/errors.md`](errors.md) where applicable.
