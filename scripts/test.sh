#!/usr/bin/env bash
# scripts/test.sh — Run the full LumenFlow test suite with optional filters.
#
# Usage:
#   ./scripts/test.sh               # lint + test
#   ./scripts/test.sh <filter>      # lint + filtered test
#   COVERAGE=1 ./scripts/test.sh    # lint + test + coverage report (requires cargo-llvm-cov)
set -euo pipefail

FILTER="${1:-}"
COVERAGE="${COVERAGE:-0}"

echo "==> Checking formatting..."
cargo fmt --all -- --check

echo "==> Running clippy..."
cargo clippy --all-targets --all-features -- -D warnings

echo "==> Running tests${FILTER:+ (filter: $FILTER)}..."
if [[ "$COVERAGE" == "1" ]]; then
  echo "==> Generating coverage report..."
  cargo llvm-cov --all-features --lcov --output-path lcov.info ${FILTER:+--test-threads=1 -- "$FILTER"}
  cargo llvm-cov report --html --output-dir coverage/
  echo "✅ Coverage report written to coverage/index.html and lcov.info"
elif [[ -n "$FILTER" ]]; then
  cargo test --all-features "$FILTER"
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
