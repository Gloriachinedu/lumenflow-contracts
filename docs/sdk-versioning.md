# SDK Compatibility and Contract Versioning Policy

This document defines how LumenFlow versions the smart contract and the TypeScript SDK, which combinations are supported together, and what guarantees are made when versions change.

---

## Version Scheme

Both the contract and the SDK follow [Semantic Versioning 2.0.0](https://semver.org/):

```
MAJOR.MINOR.PATCH
  │      │     │
  │      │     └─ Backwards-compatible bug fixes
  │      └─────── Backwards-compatible new features
  └────────────── Breaking changes
```

| Component | Current version | Location |
|-----------|----------------|----------|
| Smart contract (`lumenflow`) | `1.0.0` | `contracts/lumenflow/Cargo.toml` |
| TypeScript SDK (`@lumenflow/sdk`) | `0.2.0` | `sdk/package.json` |
| Soroban SDK (Rust) | `27.0.0` | `contracts/lumenflow/Cargo.toml` |
| Stellar SDK (Node.js) | `^16.1.0` | `sdk/package.json` |

The contract version is embedded in the WASM binary and readable at runtime via `get_contract_version()`.

---

## What Counts as a Breaking Change

### Contract — Breaking changes (MAJOR bump required)

- Removing or renaming a public entrypoint
- Changing a function signature (adding required arguments, removing optional arguments, changing argument types)
- Changing storage key layout in a way that makes existing state unreadable (see [docs/storage-schema.md](storage-schema.md))
- Removing or renaming an event topic or changing event data structure in a non-additive way
- Changing the signature payload format (see [docs/signature-format.md](signature-format.md))
- Changing error code values for existing error variants in `PaymentError`
- Introducing a new access-control check that rejects previously permitted callers

### Contract — Non-breaking changes (MINOR or PATCH bump)

- Adding a new entrypoint
- Adding an optional argument to an existing entrypoint
- Adding a new event type
- Adding new fields to structs returned by query functions (additive)
- Adding new error variants with new codes (not reusing existing codes)
- Performance improvements with no behaviour change
- Bug fixes that do not change the contract interface

### SDK — Breaking changes (MAJOR bump required)

- Removing or renaming a public method or class
- Changing a method signature in a non-backwards-compatible way
- Changing the minimum supported Node.js version
- Removing a re-exported type that consumers depended on

### SDK — Non-breaking changes (MINOR or PATCH bump)

- Adding new methods or classes
- Adding optional parameters
- Internal refactoring with no API surface change
- Adding support for a new contract entrypoint

---

## SDK / Contract Compatibility Matrix

The SDK major version tracks the contract major version it was built against. Minor and patch versions may differ.

| SDK version | Compatible contract versions | `@stellar/stellar-sdk` | Node.js | Notes |
|-------------|------------------------------|------------------------|---------|-------|
| `0.2.x` | `1.0.x` | `^16.1.0` | ≥ 20 | Current release |
| `0.1.x` | `0.x.x` | `^15.x` | ≥ 18 | End-of-life; no further patches |

> SDK `0.x` versions are pre-1.0 and may introduce breaking changes on MINOR increments. Once both SDK and contract reach `1.0.0`, the policy above applies strictly.

### Checking compatibility at runtime

Call `get_contract_version()` before initialising the SDK client to confirm the on-chain contract matches your expected version:

```typescript
import { LumenFlowClient } from "@lumenflow/sdk";

const client = new LumenFlowClient({ contractId, networkPassphrase, rpcUrl });
const contractVersion = await client.getContractVersion();

// Example: reject if the contract major version does not match the SDK's expected version
const [major] = contractVersion.split(".").map(Number);
if (major !== 1) {
  throw new Error(`Unsupported contract version: ${contractVersion}. Expected 1.x.x`);
}
```

---

## Versioning Workflow

### Releasing the contract

1. All entrypoint and storage changes for the release are merged to `main`.
2. Run `./scripts/release.sh <new-version>` — this bumps `contracts/lumenflow/Cargo.toml`, updates `Cargo.lock`, prepends a new section to `CHANGELOG.md`, and creates an annotated git tag `v<new-version>`.
3. Push the branch and tag; the `release.yml` CI workflow builds the WASM, computes the SHA-256 hash, creates a GitHub Release, and uploads the binary.
4. Update [docs/release-hashes.md](release-hashes.md) with the new hash.
5. If the contract version bump is MAJOR, create a migration guide (see [Upgrade Guide](upgrade-guide.md)).

### Releasing the SDK

1. Merge all SDK changes for the release to `main`.
2. The `sdk-release.yml` workflow uses `semantic-release` to compute the next version from Conventional Commits, publish `@lumenflow/sdk` to npm, and create a GitHub Release for the SDK tag.
3. Update the compatibility matrix in this document if the supported contract version range changes.
4. If the SDK version bump is MAJOR, update [sdk/CHANGELOG.md](../sdk/CHANGELOG.md) with a migration note.

### Synchronising after a contract breaking change

When the contract increments its MAJOR version:

1. Open an issue titled `sdk: update for contract v<MAJOR>` and label it `sdk`, `breaking-change`.
2. Update the SDK to consume the new contract interface.
3. Bump the SDK MAJOR version to match.
4. Update the compatibility matrix above.
5. Mark the previous SDK MAJOR version as end-of-life with a 90-day deprecation notice in [sdk/CHANGELOG.md](../sdk/CHANGELOG.md).

---

## Deprecation Policy

| Stage | Timeline | Actions |
|-------|----------|---------|
| **Announced** | At MAJOR release of next version | Note in CHANGELOG, update compatibility matrix |
| **Deprecated** | 90 days after announcement | Warning added to SDK methods, docs updated |
| **End-of-Life** | 90 days after deprecation | No further patches; security fixes only for 30 additional days |
| **Removed** | After EOL security window | Version removed from npm `latest`; still accessible by exact tag |

To check whether your installed SDK version is end-of-life:

```bash
npm info @lumenflow/sdk dist-tags
```

The `latest` tag always points to the current supported release.

---

## Contract Upgrade Considerations

LumenFlow is deployed on Soroban as an immutable contract instance. A "version upgrade" means deploying a new WASM to the same contract address via the Soroban contract upgrade mechanism.

**Before upgrading a production deployment:**

1. Verify that the new WASM hash matches the published hash in [docs/release-hashes.md](release-hashes.md) using `./scripts/verify-build.sh <version>`.
2. Review the [Upgrade Guide](upgrade-guide.md) for the target version.
3. Run the smoke test against testnet with the new WASM: `./scripts/smoke_test.sh`.
4. For MAJOR version upgrades: run the full compatibility matrix validation:
   ```bash
   # CI workflow — can also be triggered locally via act
   gh workflow run compat-matrix.yml
   ```
5. Pause the production contract (`pause_contract`) during the upgrade window to prevent in-flight transactions from hitting an inconsistent state.
6. After upgrade, verify `get_contract_version()` returns the expected version and unpause.

**Storage migration:** If the upgrade changes storage key layout, write and test a migration script before upgrading. Soroban does not provide automatic state migration. Refer to [docs/storage-schema.md](storage-schema.md) for the current key layout.

---

## Dependency Version Policy

### Rust / Soroban

| Dependency | Version strategy | Update cadence |
|------------|-----------------|----------------|
| Rust toolchain | Pinned in `rust-toolchain.toml` | Manual; update with `build` commit type |
| `soroban-sdk` | Exact version in `Cargo.toml` | Explicit bump PR; run full test suite |
| All other crates | Locked via `Cargo.lock` | Dependabot PRs (weekly) |

Updating `soroban-sdk` requires:
1. A separate PR with `chore: bump soroban-sdk to <version>`.
2. Full test pass (`cargo test --all-features`).
3. WASM size check (`wc -c target/wasm32-unknown-unknown/release/lumenflow.wasm` must stay ≤ 100 KB).

### TypeScript / Node.js

| Dependency | Version strategy | Update cadence |
|------------|-----------------|----------------|
| `@stellar/stellar-sdk` | `^MAJOR.MINOR.0` range | Minor/patch updates via Dependabot |
| `tweetnacl` | Exact (`1.0.3`) | Manual; cryptographic library, audit before updating |
| Node.js runtime | `≥ 20` (LTS) | New LTS support added on MINOR SDK release |
| Dev dependencies | Exact versions | Dependabot PRs (weekly) |

A breaking change in `@stellar/stellar-sdk` (MAJOR bump) requires an SDK MINOR or MAJOR release depending on the surface area affected.

---

## CI Validation

The compatibility matrix is validated on every PR and weekly by `.github/workflows/compat-matrix.yml`. It tests:

- Contract build and tests against Rust `1.87.0` (pinned) and `1.86.0` (previous patch).
- SDK build and tests against Node.js 20 and 22 with the pinned `tweetnacl` version.

A PR that breaks any matrix cell must not merge until the breakage is resolved or the matrix is intentionally updated.

To run the matrix locally (requires [act](https://github.com/nektos/act)):

```bash
act -W .github/workflows/compat-matrix.yml
```

---

## Further Reading

- [CHANGELOG.md](../CHANGELOG.md) — contract release history
- [sdk/CHANGELOG.md](../sdk/CHANGELOG.md) — SDK release history
- [docs/upgrade-guide.md](upgrade-guide.md) — migration steps for each major release
- [docs/release-hashes.md](release-hashes.md) — WASM SHA-256 hashes for verification
- [docs/signature-format.md](signature-format.md) — signature payload specification (versioned)
- [docs/storage-schema.md](storage-schema.md) — storage key layout
