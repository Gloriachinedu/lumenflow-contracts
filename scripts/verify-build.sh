#!/usr/bin/env bash
# scripts/verify-build.sh
#
# Verifies that the locally built WASM binary matches the published SHA-256
# hash for the given release version, and verifies the SLSA provenance
# attestation (.intoto.jsonl) attached to the GitHub Release using
# slsa-verifier.
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
# Environment variables:
#   REPO          GitHub repository in owner/repo form (default: derived from
#                 the git remote, falling back to the upstream project).
#   SKIP_PROVENANCE  Set to 1 to skip SLSA provenance verification.
#
# Exit codes:
#   0  Hash matches and provenance verified — build is reproducible.
#   1  Hash mismatch or provenance verification failed.
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

# ── Resolve repository (owner/repo) ───────────────────────────────────────────

resolve_repo() {
  if [[ -n "${REPO:-}" ]]; then
    echo "$REPO"
    return
  fi
  local remote
  remote="$(git config --get remote.origin.url 2>/dev/null || true)"
  if [[ -n "$remote" ]]; then
    # Handles git@github.com:owner/repo.git and https://github.com/owner/repo.git
    echo "$remote" \
      | sed -E 's#^git@[^:]+:##; s#^https?://[^/]+/##; s#\.git$##' \
      | grep -E '^[^/]+/[^/]+$' || true
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

# ── Resolve repository ────────────────────────────────────────────────────────

REPO_SLUG="$(resolve_repo)"
[[ -n "$REPO_SLUG" ]] || die "Could not determine GitHub repository. Set REPO=owner/repo."

info "Repository: $REPO_SLUG"

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

HASH_OK=0
if [[ "$ACTUAL_HASH" == "$EXPECTED_HASH" ]]; then
  info "✅  Hash match — build is reproducible for $VERSION."
  HASH_OK=1
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
fi

# ── Verify SLSA provenance ────────────────────────────────────────────────────

if [[ "${SKIP_PROVENANCE:-0}" == "1" ]]; then
  info "Skipping SLSA provenance verification (SKIP_PROVENANCE=1)."
  [[ "$HASH_OK" == "1" ]] && exit 0 || exit 1
fi

command -v slsa-verifier >/dev/null 2>&1 || die \
  "slsa-verifier not found. Install it from https://github.com/slsa-framework/slsa-verifier#installation"

PROVENANCE_FILE="$REPO_ROOT/target/lumenflow.wasm.intoto.jsonl"
PROVENANCE_ASSET="lumenflow.wasm.intoto.jsonl"
RELEASE_URL="https://github.com/$REPO_SLUG/releases/download/$VERSION/$PROVENANCE_ASSET"

info "Downloading SLSA provenance: $PROVENANCE_ASSET"
if command -v gh >/dev/null 2>&1; then
  if ! gh release download "$VERSION" \
        --repo "$REPO_SLUG" \
        --pattern "$PROVENANCE_ASSET" \
        --output "$PROVENANCE_FILE" \
        --clobber 2>&1; then
    die "Failed to download provenance asset '$PROVENANCE_ASSET' for $VERSION from $REPO_SLUG."
  fi
else
  if ! curl -fsSL "$RELEASE_URL" -o "$PROVENANCE_FILE" 2>&1; then
    die "Failed to download provenance from $RELEASE_URL (install gh or check the release)."
  fi
fi

[[ -s "$PROVENANCE_FILE" ]] || die "Provenance file $PROVENANCE_FILE is empty or missing."

info "Verifying SLSA provenance with slsa-verifier..."
if slsa-verifier verify-artifact "$WASM_PATH" \
      --provenance-path "$PROVENANCE_FILE" \
      --source-uri "github.com/$REPO_SLUG" 2>&1; then
  info "✅  SLSA provenance verified for $VERSION."
else
  echo ""
  echo "❌  SLSA PROVENANCE VERIFICATION FAILED for $VERSION"
  echo "   Artifact:   $WASM_PATH"
  echo "   Provenance: $PROVENANCE_FILE"
  echo "   Source:     github.com/$REPO_SLUG"
  echo ""
  echo "Possible causes:"
  echo "  • The artifact was not produced by the official CI release workflow."
  echo "  • The provenance file does not correspond to this artifact."
  echo "  • The release was not built from github.com/$REPO_SLUG."
  echo ""
  echo "See docs/release-hashes.md for verification instructions."
  exit 1
fi

if [[ "$HASH_OK" == "1" ]]; then
  info "✅  All checks passed for $VERSION."
  exit 0
else
  exit 1
fi
