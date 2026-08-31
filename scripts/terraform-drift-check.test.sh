#!/usr/bin/env bash
# scripts/terraform-drift-check.test.sh — Unit tests for the drift detection
# plan-parsing logic used in scripts/terraform-drift-check.sh and
# .github/workflows/terraform-drift.yml
#
# Resolves: #852
#
# These tests mock plan output and validate that the parser correctly extracts
# add/change/destroy counts and maps Terraform exit codes to drift status.

set -euo pipefail

PASS=0
FAIL=0

assert_eq() {
  local desc="$1"
  local expected="$2"
  local actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "  ✅  PASS: $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌  FAIL: $desc (expected='$expected', got='$actual')"
    FAIL=$((FAIL + 1))
  fi
}

# ── Helper: parse plan summary line (same logic as the workflow) ───────────────

parse_plan_line() {
  local line="$1"
  local ADDS CHANGES DESTROYS
  ADDS=$(echo "$line"     | grep -oP '\d+(?= to add)'     || echo "0")
  CHANGES=$(echo "$line"  | grep -oP '\d+(?= to change)'  || echo "0")
  DESTROYS=$(echo "$line" | grep -oP '\d+(?= to destroy)' || echo "0")
  echo "$ADDS $CHANGES $DESTROYS"
}

# ── Helper: map exit code to drift status ─────────────────────────────────────

interpret_exit_code() {
  case "$1" in
    0) echo "clean" ;;
    1) echo "error" ;;
    2) echo "drifted" ;;
    *) echo "unknown" ;;
  esac
}

echo ""
echo "=== terraform-drift plan parsing tests ==="
echo ""

# ── Normal path: no changes ────────────────────────────────────────────────────

result=$(parse_plan_line "No changes. Your infrastructure matches the configuration.")
assert_eq "no-changes plan line → 0 0 0" "0 0 0" "$result"

result=$(interpret_exit_code 0)
assert_eq "exit code 0 → clean" "clean" "$result"

# ── Normal path: changes present ──────────────────────────────────────────────

result=$(parse_plan_line "Plan: 3 to add, 1 to change, 0 to destroy.")
assert_eq "add+change plan line → 3 1 0" "3 1 0" "$result"

result=$(interpret_exit_code 2)
assert_eq "exit code 2 → drifted" "drifted" "$result"

# ── Edge case: destroy-only plan ──────────────────────────────────────────────

result=$(parse_plan_line "Plan: 0 to add, 0 to change, 2 to destroy.")
assert_eq "destroy-only plan line → 0 0 2" "0 0 2" "$result"

# ── Edge case: large numbers ──────────────────────────────────────────────────

result=$(parse_plan_line "Plan: 100 to add, 50 to change, 10 to destroy.")
assert_eq "large counts parsed correctly" "100 50 10" "$result"

# ── Failure: plan error exit code ─────────────────────────────────────────────

result=$(interpret_exit_code 1)
assert_eq "exit code 1 → error" "error" "$result"

# ── Edge case: unknown exit code ──────────────────────────────────────────────

result=$(interpret_exit_code 99)
assert_eq "unknown exit code → unknown" "unknown" "$result"

# ── Normal path: terraform-drift-check.sh help / bad args ─────────────────────

SCRIPT="$(dirname "$0")/terraform-drift-check.sh"
if [[ -f "$SCRIPT" ]]; then
  # Script should fail if terraform is not installed and we pass a bad env arg
  # We test only that the script is syntactically valid (bash -n)
  bash -n "$SCRIPT" && \
    { echo "  ✅  PASS: terraform-drift-check.sh passes bash syntax check"; PASS=$((PASS + 1)); } || \
    { echo "  ❌  FAIL: terraform-drift-check.sh has syntax errors"; FAIL=$((FAIL + 1)); }
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""

[[ "$FAIL" -gt 0 ]] && exit 1 || exit 0
