#!/usr/bin/env bash
# scripts/bootstrap.test.sh — Unit tests for bootstrap.sh
#
# Resolves: #855
#
# Tests idempotency properties and platform detection without modifying the
# actual system. Uses bash -n (syntax check) and mocking of the tool-detection
# functions to exercise logic branches.

set -euo pipefail

PASS=0
FAIL=0
SCRIPT="$(cd "$(dirname "$0")" && pwd)/bootstrap.sh"

assert_eq() {
  local desc="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✅  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌  FAIL: $desc (expected='$expected', got='$actual')"
    FAIL=$((FAIL + 1))
  fi
}

assert_exit() {
  local desc="$1" expected="$2"
  shift 2
  local actual=0
  "$@" >/dev/null 2>&1 || actual=$?
  assert_eq "$desc" "$expected" "$actual"
}

echo ""
echo "=== bootstrap.sh tests ==="
echo ""

# ── Syntax check ──────────────────────────────────────────────────────────────

echo "--- Syntax ---"
bash -n "$SCRIPT" && {
  echo "  ✅  PASS: bootstrap.sh passes bash syntax check"
  PASS=$((PASS + 1))
} || {
  echo "  ❌  FAIL: bootstrap.sh has syntax errors"
  FAIL=$((FAIL + 1))
}

# ── version_ge helper ─────────────────────────────────────────────────────────

echo ""
echo "--- version_ge helper ---"

# Source only the version_ge function from the script
source_version_ge() {
  # Extract and eval the version_ge function block
  eval "$(sed -n '/^version_ge()/,/^}/p' "$SCRIPT")"
}
source_version_ge

run_vge() {
  local desc="$1" a="$2" b="$3" expected="$4"
  local actual=0
  version_ge "$a" "$b" || actual=$?
  # 0 = true (a >= b), 1 = false (a < b)
  local bool="false"
  [[ "$actual" -eq 0 ]] && bool="true"
  assert_eq "$desc" "$expected" "$bool"
}

run_vge "1.87.0 >= 1.87.0 → true"  "1.87.0" "1.87.0" "true"
run_vge "1.88.0 >= 1.87.0 → true"  "1.88.0" "1.87.0" "true"
run_vge "2.0.0  >= 1.87.0 → true"  "2.0.0"  "1.87.0" "true"
run_vge "1.86.0 >= 1.87.0 → false" "1.86.0" "1.87.0" "false"
run_vge "0.9.9  >= 1.0.0  → false" "0.9.9"  "1.0.0"  "false"
run_vge "1.87.1 >= 1.87.0 → true"  "1.87.1" "1.87.0" "true"

# ── --check mode (idempotent, no side-effects) ────────────────────────────────

echo ""
echo "--- --check mode ---"

# --check should exit 0 or 2, never 1 (which would mean a crash)
CHECK_EXIT=0
bash "$SCRIPT" --check >/dev/null 2>&1 || CHECK_EXIT=$?

if [[ "$CHECK_EXIT" -eq 0 || "$CHECK_EXIT" -eq 2 ]]; then
  echo "  ✅  PASS: --check mode exits with 0 (all present) or 2 (some missing)"
  PASS=$((PASS + 1))
else
  echo "  ❌  FAIL: --check mode exited with unexpected code $CHECK_EXIT"
  FAIL=$((FAIL + 1))
fi

# Running --check twice gives the same exit code (idempotency)
CHECK_EXIT2=0
bash "$SCRIPT" --check >/dev/null 2>&1 || CHECK_EXIT2=$?
assert_eq "--check is idempotent (same exit code on repeat)" "$CHECK_EXIT" "$CHECK_EXIT2"

# ── Platform detection (injected OS/ARCH) ────────────────────────────────────

echo ""
echo "--- Platform detection ---"

detect_for_platform() {
  local os="$1" arch="$2"
  OS="$os" ARCH="$arch" bash -c "
    source <(sed -n '/^detect_platform()/,/^}/p' \"$SCRIPT\")
    detect_platform 2>&1 && echo \"\$PLATFORM\"
  " 2>/dev/null || echo "UNSUPPORTED"
}

assert_eq "Linux x86_64 → linux-x86_64"   "linux-x86_64"  "$(detect_for_platform Linux x86_64)"
assert_eq "Linux aarch64 → linux-aarch64" "linux-aarch64" "$(detect_for_platform Linux aarch64)"
assert_eq "Darwin x86_64 → macos-x86_64"  "macos-x86_64"  "$(detect_for_platform Darwin x86_64)"
assert_eq "Darwin arm64 → macos-arm64"    "macos-arm64"   "$(detect_for_platform Darwin arm64)"

# Unknown OS should exit non-zero
OS="Windows" ARCH="x86_64" bash "$SCRIPT" --check >/dev/null 2>&1 && {
  echo "  ❌  FAIL: unknown OS should exit non-zero"
  FAIL=$((FAIL + 1))
} || {
  echo "  ✅  PASS: unknown OS exits non-zero"
  PASS=$((PASS + 1))
}

# Unknown arch should exit non-zero
OS="Linux" ARCH="mips" bash "$SCRIPT" --check >/dev/null 2>&1 && {
  echo "  ❌  FAIL: unknown arch should exit non-zero"
  FAIL=$((FAIL + 1))
} || {
  echo "  ✅  PASS: unknown arch exits non-zero"
  PASS=$((PASS + 1))
}

# ── Results ───────────────────────────────────────────────────────────────────

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""

[[ "$FAIL" -gt 0 ]] && exit 1 || exit 0
