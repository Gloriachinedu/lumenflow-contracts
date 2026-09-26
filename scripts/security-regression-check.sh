#!/usr/bin/env bash
# scripts/security-regression-check.sh
#
# Coverage gate for security regression tests.
#
# Every previously-fixed security issue in LumenFlow must keep a dedicated
# regression test so the vulnerability cannot silently return. This script is
# the machine-checkable side of docs/security/regression-catalog.md: it walks
# the catalogue and asserts that each "covered" entry's guard test still exists
# in the source tree (matched by a stable marker string).
#
# Usage:
#   ./scripts/security-regression-check.sh            # verify covered entries
#   ./scripts/security-regression-check.sh --list     # print the catalogue
#   ./scripts/security-regression-check.sh --strict   # also fail on known gaps
#
# Exit codes:
#   0  All covered regression guards present (and, with --strict, no gaps).
#   1  A covered regression guard is missing — a regression test was removed
#      or renamed without updating the catalogue.
#   2  Usage / environment error.
#
# CI: wire this into the test job so removing a security regression test breaks
# the build.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# ── Catalogue ────────────────────────────────────────────────────────────────
# Format per line:  ID | STATUS | FILE | MARKER | TITLE
#   STATUS = covered | gap
#   FILE   = path that must contain MARKER (relative to repo root)
#   MARKER = literal substring that anchors the regression test
#
# Keep this table in sync with docs/security/regression-catalog.md.
read -r -d '' CATALOGUE <<'EOF' || true
VDR-001 | covered | contracts/lumenflow/tests/replay_protection.rs         | test_nonce_replay_rejected                       | Per-merchant nonce replay (#563/#351)
VDR-002 | covered | contracts/lumenflow/tests/replay_protection.rs         | test_signature_payment_replay_different_amount_rejected | Duplicate order_id / amended-amount payment replay
VDR-003 | covered | contracts/lumenflow/src/test.rs                        | Canonical signature payload tests (Issue #626)   | Cross-payload signature reuse via non-canonical encoding (#626)
VDR-004 | covered | contracts/lumenflow/tests/admin_transfer.rs            | Closes issue #347                                | Admin self-transfer / privilege-boundary bypass (#347)
VDR-005 | covered | contracts/lumenflow/src/test.rs                        | test_payer_cannot_approve_own_refund             | Payer approving their own refund (#45)
VDR-006 | covered | contracts/lumenflow/src/test.rs                        | test_total_volume_no_overflow_saturates          | Integer overflow in global volume accounting (#34)
VDR-007 | covered | contracts/lumenflow/src/prop_tests.rs                  | prop_non_positive_amount_always_rejected         | Non-positive / i128::MIN payment amounts (#616)
VDR-008 | covered | contracts/lumenflow/src/prop_tests.rs                  | prop_duplicate_order_id_always_rejected          | Duplicate order_id fuzz invariant (#616)
VDR-009 | covered | contracts/lumenflow/src/prop_tests.rs                  | prop_refund_cannot_exceed_original               | Refund exceeding original payment (#616)
VDR-010 | covered | contracts/lumenflow/src/test_error_codes.rs            | test_error_unauthorized_is_triggered             | Unauthorized-caller error-code stability (#615)
VDR-011 | covered | contracts/lumenflow/src/test.rs                        | cleanup_expired_payments safety and gas tests    | Unbounded cleanup_expired_payments gas/DoS (#287)
VDR-012 | covered | contracts/lumenflow/src/test.rs                        | String length boundary tests                     | String length boundary handling (#622)
VDR-013 | covered | contracts/lumenflow/src/test.rs                        | Refund auth security tests                       | Refund authorization matrix (#45)
VDR-014 | gap     | contracts/lumenflow/src/test.rs                        | RateLimitExceeded                                | Per-merchant payment rate-limit bypass (#565) — NO regression test yet
EOF

usage() {
  grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

MODE="verify"
STRICT=0
for arg in "$@"; do
  case "$arg" in
    --list)   MODE="list" ;;
    --strict) STRICT=1 ;;
    -h|--help) usage ;;
    *) echo "Unknown argument: $arg" >&2; usage ;;
  esac
done

trim() { sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//'; }

if [[ "$MODE" == "list" ]]; then
  printf '%-9s %-8s %s\n' "ID" "STATUS" "TITLE"
  printf '%-9s %-8s %s\n' "--" "------" "-----"
  while IFS='|' read -r id status file marker title; do
    [[ -z "${id// }" ]] && continue
    printf '%-9s %-8s %s\n' "$(echo "$id" | trim)" "$(echo "$status" | trim)" "$(echo "$title" | trim)"
  done <<< "$CATALOGUE"
  exit 0
fi

fail=0
gaps=0
checked=0

while IFS='|' read -r id status file marker title; do
  id="$(echo "$id" | trim)"
  status="$(echo "$status" | trim)"
  file="$(echo "$file" | trim)"
  marker="$(echo "$marker" | trim)"
  title="$(echo "$title" | trim)"
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

echo "RESULT: PASS"
exit 0
