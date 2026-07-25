#!/usr/bin/env bash
# scripts/verify-build.sh
#
# Verifies that the locally built WASM binary matches the published SHA-256
# hash for the given release version.
#
# Usage:
#   ./scripts/verify-build.sh [VERSION]
#
# Examples:
#   ./scripts/verify-build.sh v1.0.0
#   VERSION=v1.0.0 ./scripts/verify-build.sh
#
# If VERSION is not supplied the script looks for the most recent git tag.
#
# Exit codes:
#   0  Hash matches — build is reproducible.
#   1  Hash mismatch — binary does not match the published hash.
#   2  Usage / environment error.

set -euo pipefail

# ── Helpers ───────────────────────────────────────────────────────────────────

die() { echo "ERROR: $*" >&2; exit 2; }
info() { echo "[verify-build] $*"; }

# ── Prerequisites ─────────────────────────────────────────────────────────────

command -v cargo  >/dev/null 2>&1 || die "cargo not found. Install Rust via https://rustup.rs"
command -v sha256sum >/dev/null 2>&1 || \
  command -v shasum   >/dev/null 2>&1 || \
  die "sha256sum / shasum not found."

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# ── Resolve version ───────────────────────────────────────────────────────────

VERSION="${1:-${VERSION:-}}"
if [[ -z "$VERSION" ]]; then
  VERSION="$(git describe --tags --abbrev=0 2>/dev/null || true)"
fi
[[ -n "$VERSION" ]] || die "No version supplied and no git tag found. Pass a version as the first argument."

info "Verifying WASM for release: $VERSION"

# ── Look up expected hash ─────────────────────────────────────────────────────

HASHES_FILE="$(dirname "$0")/../docs/release-hashes.md"
[[ -f "$HASHES_FILE" ]] || die "Release hashes file not found at $HASHES_FILE"

# Parse the markdown table for the requested version
EXPECTED_HASH="$(grep -E "^\| *\`?${VERSION}\`? *\|" "$HASHES_FILE" | awk -F'|' '{gsub(/ /,"",$3); print $3}' | head -1)"
[[ -n "$EXPECTED_HASH" ]] || die "No hash entry found for version '$VERSION' in $HASHES_FILE"

info "Expected SHA-256: $EXPECTED_HASH"

# ── Build WASM ────────────────────────────────────────────────────────────────

REPO_ROOT="$(git rev-parse --show-toplevel)"
WASM_PATH="$REPO_ROOT/target/wasm32-unknown-unknown/release/lumenflow.wasm"

info "Building WASM (this may take a few minutes)..."
cargo build \
  --target wasm32-unknown-unknown \
  --release \
  --package lumenflow \
  --locked \
  2>&1

[[ -f "$WASM_PATH" ]] || die "WASM artifact not found at $WASM_PATH after build."

# ── Compare hashes ────────────────────────────────────────────────────────────

ACTUAL_HASH="$(sha256 "$WASM_PATH")"
info "Actual   SHA-256: $ACTUAL_HASH"

if [[ "$ACTUAL_HASH" == "$EXPECTED_HASH" ]]; then
  info "✅  Hash match — build is reproducible for $VERSION."
  exit 0
else
  echo ""
  echo "❌  HASH MISMATCH for $VERSION"
  echo "   Expected: $EXPECTED_HASH"
  echo "   Actual:   $ACTUAL_HASH"
  echo ""
  echo "Possible causes:"
  echo "  • You are not using the pinned Rust toolchain (check rust-toolchain.toml)."
  echo "  • Cargo.lock has changed since the release was published."
  echo "  • The WASM optimiser version differs from the release environment."
  echo ""
  echo "See docs/release-hashes.md and README.md for verification instructions."
  exit 1
fi
