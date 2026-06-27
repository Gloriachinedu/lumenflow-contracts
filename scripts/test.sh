#!/usr/bin/env bash
# scripts/test.sh — Run the full LumenFlow test suite with optional filters.
#
# Usage:
#   ./scripts/test.sh               # lint + test
#   ./scripts/test.sh <filter>      # lint + filtered test
#   COVERAGE=1 ./scripts/test.sh    # lint + test + coverage report (requires cargo-llvm-cov)
set -euo pipefail

FILTER="${1:-}"

echo "==> Checking formatting..."
cargo fmt --all -- --check

echo "==> Running clippy..."
cargo clippy --all-targets --all-features -- -D warnings

if [[ "${COVERAGE:-}" == "1" ]]; then
  echo "==> Running tests with coverage (cargo-llvm-cov)..."
  if ! cargo llvm-cov --version &>/dev/null; then
    echo "Installing cargo-llvm-cov..."
    cargo install cargo-llvm-cov --locked
  fi
  if [[ -n "$FILTER" ]]; then
    cargo llvm-cov --all-features --lcov --output-path lcov.info "$FILTER"
  else
    cargo llvm-cov --all-features --lcov --output-path lcov.info
  fi
  echo "Coverage report written to lcov.info"
else
  echo "==> Running tests${FILTER:+ (filter: $FILTER)}..."
  if [[ -n "$FILTER" ]]; then
    cargo test --all-features "$FILTER"
  else
    cargo test --all-features
  fi
fi

echo ""
echo "✅ All checks passed."
