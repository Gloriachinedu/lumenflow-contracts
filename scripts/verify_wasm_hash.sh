#!/usr/bin/env bash
# scripts/verify_wasm_hash.sh — Verify that a deployed contract's on-chain WASM hash
# matches the SHA-256 of a local or release artifact.
#
# Usage (local build):
#   CONTRACT_ID=C... NETWORK=testnet ./scripts/verify_wasm_hash.sh
#
# Usage (release artifact):
#   CONTRACT_ID=C... NETWORK=testnet RELEASE_TAG=v0.1.0 ./scripts/verify_wasm_hash.sh
#
# Required env vars:
#   CONTRACT_ID   — deployed Soroban contract ID (C...)
#   NETWORK       — stellar network: local | testnet | mainnet (default: testnet)
#
# Optional env vars:
#   RELEASE_TAG   — GitHub release tag (e.g. v0.1.0). If set, the WASM is downloaded
#                   from the GitHub release instead of built locally.
#   WASM_PATH     — path to a pre-built WASM file. Takes precedence over RELEASE_TAG
#                   and local build.
#   GITHUB_REPO   — owner/repo for release download (default: Gloriachinedu/lumenflow-contracts)
set -euo pipefail

NETWORK="${NETWORK:-testnet}"
CONTRACT_ID="${CONTRACT_ID:-}"
RELEASE_TAG="${RELEASE_TAG:-}"
WASM_PATH="${WASM_PATH:-}"
GITHUB_REPO="${GITHUB_REPO:-Gloriachinedu/lumenflow-contracts}"

: "${CONTRACT_ID:?CONTRACT_ID is required}"

# ── Validate format ────────────────────────────────────────────────────────────
if ! [[ "$CONTRACT_ID" =~ ^C[A-Z2-7]{55}$ ]]; then
  echo "ERROR: CONTRACT_ID must be a 56-character Soroban contract address (C...)." >&2
  exit 1
fi

# ── Require stellar CLI ────────────────────────────────────────────────────────
if ! command -v stellar &>/dev/null; then
  echo "ERROR: stellar CLI is required. Install from https://developers.stellar.org/docs/tools/stellar-cli" >&2
  exit 1
fi

WASM_FILE=""
CLEANUP=0

if [[ -n "$WASM_PATH" ]]; then
  # Use provided path directly
  if [[ ! -f "$WASM_PATH" ]]; then
    echo "ERROR: WASM_PATH '$WASM_PATH' does not exist." >&2
    exit 1
  fi
  WASM_FILE="$WASM_PATH"
  echo "==> Using provided WASM: $WASM_FILE"
elif [[ -n "$RELEASE_TAG" ]]; then
  # Download WASM from GitHub release
  echo "==> Downloading WASM from GitHub release $RELEASE_TAG..."
  ARTIFACT_NAME="lumenflow_${RELEASE_TAG}.wasm"
  DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${RELEASE_TAG}/${ARTIFACT_NAME}"
  TMPDIR_WASM=$(mktemp -d)
  WASM_FILE="${TMPDIR_WASM}/${ARTIFACT_NAME}"
  CLEANUP=1
  if command -v curl &>/dev/null; then
    curl -fsSL "$DOWNLOAD_URL" -o "$WASM_FILE"
  elif command -v wget &>/dev/null; then
    wget -q "$DOWNLOAD_URL" -O "$WASM_FILE"
  else
    echo "ERROR: curl or wget is required to download the release artifact." >&2
    exit 1
  fi
  echo "    Downloaded to: $WASM_FILE"
else
  # Build from source
  echo "==> Building WASM from source (release)..."
  cargo build --locked \
    --target wasm32-unknown-unknown \
    --release \
    --package lumenflow
  WASM_FILE="target/wasm32-unknown-unknown/release/lumenflow.wasm"
  echo "    Built: $WASM_FILE"
fi

cleanup() {
  if [[ "$CLEANUP" -eq 1 && -n "${TMPDIR_WASM:-}" ]]; then
    rm -rf "$TMPDIR_WASM"
  fi
}
trap cleanup EXIT

# ── Compute local hash ────────────────────────────────────────────────────────
echo "==> Computing SHA-256 of local WASM..."
if command -v sha256sum &>/dev/null; then
  LOCAL_HASH=$(sha256sum "$WASM_FILE" | awk '{print $1}')
else
  LOCAL_HASH=$(shasum -a 256 "$WASM_FILE" | awk '{print $1}')
fi
echo "    Local hash  : $LOCAL_HASH"

# ── Fetch on-chain WASM hash ──────────────────────────────────────────────────
echo "==> Fetching on-chain WASM hash for contract $CONTRACT_ID on $NETWORK..."

# stellar contract info prints the wasm_hash among other fields
# We look for a line containing the hash
CONTRACT_INFO=$(stellar contract info \
  --contract-id "$CONTRACT_ID" \
  --network "$NETWORK" 2>&1) || {
  echo "ERROR: Failed to fetch contract info. Is the contract deployed on $NETWORK?" >&2
  echo "$CONTRACT_INFO" >&2
  exit 1
}

# Extract wasm_hash: try multiple output formats
ONCHAIN_HASH=$(echo "$CONTRACT_INFO" | grep -i 'wasm_hash\|wasm hash\|hash' | head -1 | grep -oE '[0-9a-f]{64}' | head -1 || true)

if [[ -z "$ONCHAIN_HASH" ]]; then
  echo "" 
  echo "Could not automatically extract on-chain hash. Contract info output:"
  echo "$CONTRACT_INFO"
  echo ""
  echo "Please manually compare the local hash against the wasm_hash field above."
  echo "Local hash: $LOCAL_HASH"
  exit 2
fi

echo "    On-chain hash: $ONCHAIN_HASH"

# ── Compare ──────────────────────────────────────────────────────────────────
echo ""
if [[ "$LOCAL_HASH" == "$ONCHAIN_HASH" ]]; then
  echo "✅ WASM hash verified: local artifact matches on-chain deployment."
  echo "   hash    : $LOCAL_HASH"
  echo "   network : $NETWORK"
  echo "   contract: $CONTRACT_ID"
  exit 0
else
  echo "❌ WASM hash MISMATCH!"
  echo "   local    : $LOCAL_HASH"
  echo "   on-chain : $ONCHAIN_HASH"
  echo "   network  : $NETWORK"
  echo "   contract : $CONTRACT_ID"
  echo ""
  echo "The deployed contract does not match the expected artifact."
  echo "Investigate: was the wrong version deployed, or has the contract been upgraded?"
  exit 1
fi
