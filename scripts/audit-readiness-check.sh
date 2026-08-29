#!/usr/bin/env bash
# scripts/audit-readiness-check.sh
#
# Pre-mainnet audit readiness gate.
#
# Verifies that the artifacts an independent auditor needs (and the gates that
# must be cleared before mainnet) are present in the repo. This is the
# machine-checkable side of docs/audit/audit-engagement-plan.md.
#
# It does NOT contact any auditor or check external state — it checks that the
# repo is in a state where an audit can start and where a go/no-go review has
# what it needs.
#
# Usage:
#   ./scripts/audit-readiness-check.sh            # handoff-package readiness
#   ./scripts/audit-readiness-check.sh --mainnet  # also enforce mainnet gate
#
# Exit codes:
#   0  All required artifacts present (and, with --mainnet, gate satisfied).
#   1  A required artifact is missing.
#   2  Usage / environment error.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MAINNET=0
for arg in "$@"; do
  case "$arg" in
    --mainnet) MAINNET=1 ;;
    -h|--help) grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

fail=0
pass=0

require_file() {
  local path="$1" why="$2"
  if [[ -f "$path" ]]; then
    echo "OK    $path"
    pass=$((pass + 1))
  else
    echo "FAIL  $path — $why"
    fail=1
  fi
}

require_contains() {
  local path="$1" marker="$2" why="$3"
  if [[ -f "$path" ]] && grep -qF -- "$marker" "$path"; then
    echo "OK    $path :: \"$marker\""
    pass=$((pass + 1))
  else
    echo "FAIL  $path :: \"$marker\" — $why"
    fail=1
  fi
}

echo "== Auditor handoff package =="
require_file "docs/audit/audit-engagement-plan.md"        "engagement plan defines scope + gates"
require_file "docs/audit/audit-report-v1.0.md"            "findings + remediation tracking template"
require_file "docs/audit/threat-model-refund-flows.md"    "threat model for auditor context"
require_file "docs/security/regression-catalog.md"        "regression coverage index"
require_file "docs/ARCHITECTURE.md"                       "architecture overview"
require_file "docs/auth-model.md"                         "authorization model"
require_file "docs/storage-schema.md"                     "storage layout"
require_file "docs/signature-format.md"                   "signature payload spec"
require_file "docs/release-hashes.md"                     "reproducible-build hashes"
require_file "scripts/verify-build.sh"                    "reproducible-build verification"
require_file "contracts/lumenflow/src/lib.rs"             "in-scope contract entry points"
require_file "contracts/lumenflow/src/prop_tests.rs"      "property/fuzz tests for auditor"

echo
echo "== In-scope source tree =="
for f in types.rs storage.rs error.rs helper.rs; do
  require_file "contracts/lumenflow/src/$f" "in-scope audit target"
done

echo
echo "== Engagement plan integrity =="
require_contains "docs/audit/audit-engagement-plan.md" "Mainnet deployment gate" "gate section present"
require_contains "docs/audit/audit-engagement-plan.md" "Re-audit triggers"        "re-audit policy present"
require_contains "docs/audit/audit-report-v1.0.md"     "Remediation Tracking"     "remediation table present"

if [[ "$MAINNET" -eq 1 ]]; then
  echo
  echo "== Mainnet deployment gate (--mainnet) =="

  # 1. Regression coverage gate must pass.
  if ./scripts/security-regression-check.sh >/dev/null 2>&1; then
    echo "OK    security-regression-check.sh passes"
    pass=$((pass + 1))
  else
    echo "FAIL  security-regression-check.sh failed"
    fail=1
  fi

  # 2. Audit report must no longer be marked pending.
  if grep -qE "Report Status:.*(Pending|🔴)" docs/audit/audit-report-v1.0.md; then
    echo "FAIL  audit-report-v1.0.md still marked Pending — final report not delivered"
    fail=1
  else
    echo "OK    audit report no longer marked pending"
    pass=$((pass + 1))
  fi

  # 3. No unresolved Critical/High findings left as placeholders.
  if grep -qE "^\| — \| — \| Pending audit completion" docs/audit/audit-report-v1.0.md; then
    echo "FAIL  findings overview still a placeholder — audit not complete"
    fail=1
  else
    echo "OK    findings overview populated"
    pass=$((pass + 1))
  fi

  # 4. Deployment readiness line must not say 'Not ready'.
  if grep -qF "Not ready for mainnet" docs/audit/audit-report-v1.0.md; then
    echo "FAIL  audit-report-v1.0.md §10 still says 'Not ready for mainnet'"
    fail=1
  else
    echo "OK    audit report §10 cleared for mainnet"
    pass=$((pass + 1))
  fi
fi

echo
echo "Passed $pass check(s)."
if [[ "$fail" -ne 0 ]]; then
  echo "RESULT: NOT READY" >&2
  exit 1
fi
echo "RESULT: READY"
exit 0
