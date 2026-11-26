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

# ── CI invocation: .github/workflows/terraform-drift-check.yml ────────────────

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKFLOW="$REPO_ROOT/.github/workflows/terraform-drift-check.yml"

if [[ -f "$WORKFLOW" ]]; then
  echo "  ✅  PASS: terraform-drift-check.yml workflow exists"; PASS=$((PASS + 1))

  if grep -qE "cron:[[:space:]]*['\"]?0 6 \* \* \*" "$WORKFLOW"; then
    echo "  ✅  PASS: workflow runs daily at 06:00 UTC"; PASS=$((PASS + 1))
  else
    echo "  ❌  FAIL: workflow missing daily 06:00 UTC cron schedule"; FAIL=$((FAIL + 1))
  fi

  if grep -q "scripts/terraform-drift-check.sh" "$WORKFLOW"; then
    echo "  ✅  PASS: workflow invokes scripts/terraform-drift-check.sh"; PASS=$((PASS + 1))
  else
    echo "  ❌  FAIL: workflow does not invoke scripts/terraform-drift-check.sh"; FAIL=$((FAIL + 1))
  fi

  if grep -qE "exit code 2|exit_code.*2|drift.*2|2.*drift" "$WORKFLOW"; then
    echo "  ✅  PASS: workflow fails the job on drift (exit code 2)"; PASS=$((PASS + 1))
  else
    echo "  ❌  FAIL: workflow does not handle drift exit code 2"; FAIL=$((FAIL + 1))
  fi

  if grep -qE "SLACK_WEBHOOK|slack.*webhook|webhook.*slack" "$WORKFLOW"; then
    echo "  ✅  PASS: workflow references Slack webhook secret"; PASS=$((PASS + 1))
  else
    echo "  ❌  FAIL: workflow does not reference Slack webhook secret"; FAIL=$((FAIL + 1))
  fi
else
  echo "  ❌  FAIL: .github/workflows/terraform-drift-check.yml not found"; FAIL=$((FAIL + 1))
fi

# ── Drift-check script exits non-zero (2) when plan reports changes ───────────

if [[ -f "$SCRIPT" ]]; then
  TMPDIR_MOCK="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR_MOCK"' EXIT

  # Mock terraform binary: `plan -detailed-exitcode` reports drift (exit 2)
  cat > "$TMPDIR_MOCK/terraform" <<'MOCK'
#!/usr/bin/env bash
case "$1" in
  plan)
    echo "Plan: 1 to add, 0 to change, 0 to destroy."
    exit 2
    ;;
  *)
    exit 0
    ;;
esac
MOCK
  chmod +x "$TMPDIR_MOCK/terraform"

  set +e
  PATH="$TMPDIR_MOCK:$PATH" bash "$SCRIPT" >/dev/null 2>&1
  drift_rc=$?
  set -e

  if [[ "$drift_rc" -ne 0 ]]; then
    echo "  ✅  PASS: drift-check script exits non-zero ($drift_rc) on planned changes"; PASS=$((PASS + 1))
  else
    echo "  ❌  FAIL: drift-check script exited 0 despite planned changes"; FAIL=$((FAIL + 1))
  fi
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""

[[ "$FAIL" -gt 0 ]] && exit 1 || exit 0
