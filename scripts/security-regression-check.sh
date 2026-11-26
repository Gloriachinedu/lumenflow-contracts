#!/usr/bin/env bash
# scripts/security-regression-check.sh
#
# Coverage gate for security regression tests.
#
# Every previously-fixed security issue in LumenFlow must keep a dedicated
# regression test so the vulnerability cannot silently return. This script is
# the machine-checkable side of docs/security/regression-catalog.md: it walks
# the catalogue and asserts that each "covered" entry's guard test still exists
# in the source tree (matched by a stable marker string), and then actually
# executes the regression suites (cargo test for the contract, jest for the SDK
# security tests) so a guard that exists but no longer passes still fails CI.
#
# POLICY: every new security fix MUST ship, in the same PR:
#   1. a regression test that would have caught the original bug, and
#   2. a new row in the CATALOGUE below (and in
#      docs/security/regression-catalog.md) pointing at that test's marker.
# A fix PR without both is incomplete and will fail review.
#
# Usage:
#   ./scripts/security-regression-check.sh            # verify + run suites
#   ./scripts/security-regression-check.sh --list     # print the catalogue
#   ./scripts/security-regression-check.sh --markers  # only verify markers
#   ./scripts/security-regression-check.sh --strict   # also fail on known gaps
#                                                     # and on security-labeled
#                                                     # issues missing a row
#
# Exit codes:
#   0  All covered regression guards present and passing (and, with --strict,
#      no gaps and no uncatalogued security issues).
#   1  A covered regression guard is missing or failing — a regression test was
#      removed, renamed, or broken without updating the catalogue.
#   2  Usage / environment error.
#
# CI: wire this into the test job so removing a security regression test breaks
# the build.
=======

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Catalogue ────────────────────────────────────────────────────────────────
# Format per line:  ID | STATUS | FILE | MARKER | TITLE | FIX_COMMIT
#   STATUS     = covered | gap
#   FILE       = path that must contain MARKER (relative to repo root)
#   MARKER     = literal substring that anchors the regression test
#   FIX_COMMIT = commit that fixed the original vulnerability (inventory ref)
#
# Keep this table in sync with docs/security/regression-catalog.md.
read -r -d '' CATALOGUE <<'EOF' || true
VDR-001 | covered | contracts/lumenflow/tests/replay_protection.rs         | test_nonce_replay_rejected                       | Per-merchant nonce replay (#563/#351) | 4f1c9ab
VDR-002 | covered | contracts/lumenflow/tests/replay_protection.rs         | test_signature_payment_replay_different_amount_rejected | Duplicate order_id / amended-amount payment replay | 9d2e7c0
VDR-003 | covered | contracts/lumenflow/src/test.rs                        | Canonical signature payload tests (Issue #626)   | Cross-payload signature reuse via non-canonical encoding (#626) | 1a8b3f5
VDR-004 | covered | contracts/lumenflow/tests/admin_transfer.rs            | Closes issue #347                                | Admin self-transfer / privilege-boundary bypass (#347) | 7c4d0e2
VDR-005 | covered | contracts/lumenflow/src/test.rs                        | test_payer_cannot_approve_own_refund             | Payer approving their own refund (#45) | 2b6f8a1
VDR-006 | covered | contracts/lumenflow/src/test.rs                        | test_total_volume_no_overflow_saturates          | Integer overflow in global volume accounting (#34) | 5e9a1c3
VDR-007 | covered | contracts/lumenflow/src/prop_tests.rs                  | prop_non_positive_amount_always_rejected         | Non-positive / i128::MIN payment amounts (#616) | 8f3b2d7
VDR-008 | covered | contracts/lumenflow/src/prop_tests.rs                  | prop_duplicate_order_id_always_rejected          | Duplicate order_id fuzz invariant (#616) | 8f3b2d7
VDR-009 | covered | contracts/lumenflow/src/prop_tests.rs                  | prop_refund_cannot_exceed_original               | Refund exceeding original payment (#616) | 8f3b2d7
VDR-010 | covered | contracts/lumenflow/src/test_error_codes.rs            | test_error_unauthorized_is_triggered             | Unauthorized-caller error-code stability (#615) | 3c7e5b9
VDR-011 | covered | contracts/lumenflow/src/test.rs                        | cleanup_expired_payments safety and gas tests    | Unbounded cleanup_expired_payments gas/DoS (#287) | 6a2d4f8
VDR-012 | covered | contracts/lumenflow/src/test.rs                        | String length boundary tests                     | String length boundary handling (#622) | 0d5c8e1
VDR-013 | covered | contracts/lumenflow/src/test.rs                        | Refund auth security tests                       | Refund authorization matrix (#45) | 2b6f8a1
VDR-014 | gap     | contracts/lumenflow/src/test.rs                        | RateLimitExceeded                                | Per-merchant payment rate-limit bypass (#565) — NO regression test yet | 4a9f6c2
VDR-015 | covered | contracts/lumenflow/src/helper.rs                      | test_constant_time_eq_bytes                      | Timing side-channel in byte comparison — audit + constant_time_eq_bytes helper (#1098) | b1e7d30
VDR-016 | covered | contracts/lumenflow/tests/admin_access_control_regression.rs | admin_only_functions_reject_non_admin_caller | Admin-only access control regression: all 12 functions reject non-admin (#1268) | c4f2a86
EOF

# ── Regression suites ────────────────────────────────────────────────────────
# Suites executed after marker verification. Each entry is a shell command run
# from the repo root; a non-zero exit fails the gate.
run_contract_suite() {
  echo "── Running contract security regression tests (cargo test) ──"
  ( cd contracts/lumenflow && cargo test --quiet --all-targets ) || return 1
}

run_sdk_suite() {
  echo "── Running SDK security regression tests (jest) ──"
  if [[ ! -d sdk ]]; then
    echo "SKIP  sdk/ not present"
    return 0
  fi
  ( cd sdk && npx --no-install jest src/tests/security --ci --silent ) || return 1
}

# ── Strict-mode issue inventory check ────────────────────────────────────────
# With --strict, every closed issue carrying the `security` label must have a
# catalogue row (referenced by its issue number in the TITLE column). Requires
# the `gh` CLI and an authenticated session; skipped with a warning otherwise.
check_issue_inventory() {
  if ! command -v gh >/dev/null 2>&1; then
    echo "WARN  --strict: gh CLI not available; skipping issue inventory check" >&2
    return 0
  fi
  local issues missing=0
  if ! issues="$(gh issue list --state closed --label security --limit 500 --json number --jq '.[].number' 2>/dev/null)"; then
    echo "WARN  --strict: could not query issues; skipping issue inventory check" >&2
    return 0
  fi
  while read -r num; do
    [[ -z "$num" ]] && continue
    if ! grep -qE "#${num}([^0-9]|$)" <<< "$CATALOGUE"; then
      echo "FAIL  closed security issue #$num has no catalogue entry"
      missing=1
    fi
  done <<< "$issues"
  if [[ "$missing" -ne 0 ]]; then
    echo "      → add a regression test and a CATALOGUE row referencing #<issue>"
    return 1
  fi
  echo "OK    every closed security issue has a catalogue entry"
  return 0
}

usage() {
  grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

MODE="verify"
STRICT=0
RUN_SUITES=1
for arg in "$@"; do
  case "$arg" in
    --list)    MODE="list" ;;
    --markers) RUN_SUITES=0 ;;
    --strict)  STRICT=1 ;;
    -h|--help) usage ;;
    *) echo "Unknown argument: $arg" >&2; usage ;;
  esac
done

trim() { sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

if [[ "$MODE" == "list" ]]; then
  printf '%-9s %-8s %-10s %s\n' "ID" "STATUS" "FIX_COMMIT" "TITLE"
  printf '%-9s %-8s %-10s %s\n' "--" "------" "----------" "-----"
  while IFS='|' read -r id status file marker title fix_commit; do
    [[ -z "${id// }" ]] && continue
    printf '%-9s %-8s %-10s %s\n' \
      "$(echo "$id" | trim)" \
      "$(echo "$status" | trim)" \
      "$(echo "${fix_commit:-n/a}" | trim)" \
      "$(echo "$title" | trim)"
  done <<< "$CATALOGUE"
  exit 0
fi

fail=0
gaps=0
checked=0

while IFS='|' read -r id status file marker title fix_commit; do
  id="$(echo "$id" | trim)"
  status="$(echo "$status" | trim)"
  file="$(echo "$file" | trim)"
  marker="$(echo "$marker" | trim)"
  title="$(echo "$title" | trim)"
  fix_commit="$(echo "${fix_commit:-}" | trim)"
  [[ -z "$id" ]] && continue

  if [[ "$status" == "gap" ]]; then
    gaps=$((gaps + 1))
    echo "GAP   $id  $title"
    echo "      → add a regression test containing marker: \"$marker\" in $file"
    if [[ "$STRICT" -eq 1 ]]; then fail=1; fi
    continue
  fi

  checked=$((checked + 1))
  if [[ ! -f "$file" ]]; then
    echo "FAIL  $id  missing file: $file"
    fail=1
    continue
  fi
  if grep -qF -- "$marker" "$file"; then
    echo "OK    $id  $title"
  else
    echo "FAIL  $id  marker not found in $file: \"$marker\""
    fail=1
  fi
done <<< "$CATALOGUE"

echo
echo "Checked $checked covered guard(s); $gaps known gap(s)."

if [[ "$fail" -ne 0 ]]; then
  echo "RESULT: FAIL — a security regression guard is missing." >&2
  exit 1
fi

if [[ "$RUN_SUITES" -eq 1 ]]; then
  echo
  if ! run_contract_suite; then
    echo "RESULT: FAIL — contract security regression suite failed." >&2
    exit 1
  fi
  if ! run_sdk_suite; then
    echo "RESULT: FAIL — SDK security regression suite failed." >&2
    exit 1
  fi
fi

if [[ "$STRICT" -eq 1 ]]; then
  echo
  if ! check_issue_inventory; then
    echo "RESULT: FAIL — a closed security issue lacks a regression catalogue entry." >&2
    exit 1
  fi
fi

echo "RESULT: PASS"
exit 0
