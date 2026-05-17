#!/usr/bin/env bash
# scripts/test.sh — Run the full LumenFlow test suite with optional filters.
set -euo pipefail

FILTER="${1:-}"

echo "==> Checking formatting..."
cargo fmt --all -- --check

echo "==> Running clippy..."
cargo clippy --all-targets --all-features -- -D warnings

echo "==> Running tests${FILTER:+ (filter: $FILTER)}..."
if [[ -n "$FILTER" ]]; then
  cargo test --all-features "$FILTER"
else
  cargo test --all-features
fi

echo ""
echo "✅ All checks passed."
