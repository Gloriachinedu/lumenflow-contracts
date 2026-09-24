# Release Hashes

This file records the canonical SHA-256 hashes of the compiled `lumenflow.wasm`
binary for every release. These hashes are used by `scripts/verify-build.sh` to
confirm that a locally produced binary matches the official release artifact.

## How to verify

```bash
# Install the pinned toolchain
rustup toolchain install           # reads rust-toolchain.toml automatically

# Verify against a specific release tag
./scripts/verify-build.sh v1.0.0

# Or set VERSION in the environment
VERSION=v1.0.0 ./scripts/verify-build.sh
```

The script will:
1. Build the WASM from your local source using `--locked` (ensuring Cargo.lock
   is respected exactly).
2. Compute the SHA-256 of the resulting binary.
3. Compare it against the entry in this table.
4. Exit `0` on match, `1` on mismatch.

## Published Hashes

| Version | SHA-256 Hash | Build Date | Rust Toolchain |
|---------|-------------|------------|----------------|
| `v1.0.0` | `placeholder_hash_update_on_first_release_build` | 2026-07-24 | 1.87.0 |

> **Note for maintainers:** When cutting a release, build the WASM in the CI
> environment, compute `sha256sum target/wasm32-unknown-unknown/release/lumenflow.wasm`,
> and add a row to the table above **before** publishing the GitHub Release.
> The `release.yml` workflow does this automatically as part of the release job.

## Ensuring a reproducible build

The following factors are pinned to guarantee byte-for-byte identical output
across machines:

| Factor | How it is pinned |
|--------|-----------------|
| Rust compiler version | `rust-toolchain.toml` — `channel = "1.87.0"` |
| Dependency versions | `Cargo.lock` committed to the repository |
| Compiler flags | `[profile.release]` in root `Cargo.toml` (`codegen-units = 1`, `opt-level = "z"`, `strip = "symbols"`) |
| Build command | `cargo build --target wasm32-unknown-unknown --release --package lumenflow --locked` |

If your locally computed hash differs, verify that:

- You are using the exact toolchain version in `rust-toolchain.toml` (run
  `rustc --version` and compare).
- `Cargo.lock` has not been modified locally (`git diff Cargo.lock`).
- You used the `--locked` flag (prevents Cargo from updating dependencies).
