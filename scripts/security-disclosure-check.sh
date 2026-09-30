#!/usr/bin/env bash
# scripts/security-disclosure-check.sh
#
# Validates that LumenFlow's vulnerability-disclosure surface is intact:
#   - .well-known/security.txt is present, well-formed, and not expired (RFC 9116)
#   - SECURITY.md contains the sections reporters and responders rely on
#   - the disclosure / incident-response workflow and runbook exist and are linked
#
# Usage:
#   ./scripts/security-disclosure-check.sh
#
# Exit codes:
#   0  All checks pass.
#   1  A required file, field, or section is missing / security.txt is expired.
#   2  Usage / environment error.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

case "${1:-}" in
  "") ;;
  -h|--help) grep -E '^# ' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
  *) echo "Unknown argument: $1" >&2; exit 2 ;;
esac

fail=0
ok() { echo "OK    $*"; }
bad() { echo "FAIL  $*"; fail=1; }

SECTXT=".well-known/security.txt"
WORKFLOW="docs/security/vulnerability-disclosure-and-incident-response.md"
RUNBOOK="docs/runbooks/incident-response-runbook.md"

# ── 1. security.txt ──────────────────────────────────────────────────────────
if [[ -f "$SECTXT" ]]; then
  ok "$SECTXT present"

  for field in "Contact:" "Expires:" "Policy:"; do
    if grep -q "^${field}" "$SECTXT"; then
      ok "$SECTXT has ${field%:}"
    else
      bad "$SECTXT missing required field: ${field%:}"
    fi
  done

  # Contact must be reachable-looking (mailto: or https:)
  if grep -qE "^Contact:[[:space:]]*(mailto:|https://)" "$SECTXT"; then
    ok "$SECTXT Contact is a mailto:/https: URI"
  else
    bad "$SECTXT Contact must be a mailto: or https: URI"
  fi

  # Expires must be a future date (RFC 9116 §2.5.5)
  exp_raw="$(grep -m1 "^Expires:" "$SECTXT" | sed 's/^Expires:[[:space:]]*//' | tr -d '\r')"
  if [[ -n "$exp_raw" ]]; then
    if exp_epoch="$(date -u -d "$exp_raw" +%s 2>/dev/null)"; then
      now_epoch="$(date -u +%s)"
      if (( exp_epoch > now_epoch )); then
        days=$(( (exp_epoch - now_epoch) / 86400 ))
        ok "$SECTXT Expires in ${days} day(s) ($exp_raw)"
        if (( days < 30 )); then
          echo "WARN  $SECTXT expires in under 30 days — schedule a refresh"
        fi
      else
        bad "$SECTXT Expires is in the past: $exp_raw"
      fi
    else
      bad "$SECTXT Expires is not a parseable date: $exp_raw"
    fi
  else
    bad "$SECTXT Expires value is empty"
  fi
else
  bad "$SECTXT is missing (RFC 9116)"
fi

# ── 2. SECURITY.md sections ─────────────────────────────────────────────────
if [[ -f SECURITY.md ]]; then
  ok "SECURITY.md present"
  while IFS= read -r section; do
    if grep -qiF -- "$section" SECURITY.md; then
      ok "SECURITY.md covers: $section"
    else
      bad "SECURITY.md missing section: $section"
    fi
  done <<'SECTIONS'
Reporting a Vulnerability
Response Timeline
Incident Response Playbook
Disclosure Policy
Scope
Emergency Pause Mechanism
SECTIONS

  if grep -qF "security@lumenflow.dev" SECURITY.md; then
    ok "SECURITY.md publishes the security contact address"
  else
    bad "SECURITY.md does not publish a security contact address"
  fi
else
  bad "SECURITY.md is missing"
fi

# ── 3. Workflow + runbook ──────────────────────────────────────────────────
[[ -f "$WORKFLOW" ]] && ok "$WORKFLOW present" || bad "$WORKFLOW is missing"
[[ -f "$RUNBOOK" ]]  && ok "$RUNBOOK present"  || bad "$RUNBOOK is missing"

if [[ -f "$WORKFLOW" ]]; then
  for marker in "Disclosure workflow" "Incident response workflow" "Post-incident review" "Roles"; do
    grep -qF -- "$marker" "$WORKFLOW" && ok "$WORKFLOW covers: $marker" \
      || bad "$WORKFLOW missing: $marker"
  done
fi

# ── 4. Cross-links ─────────────────────────────────────────────────────────
if grep -qF "vulnerability-disclosure-and-incident-response.md" SECURITY.md; then
  ok "SECURITY.md links the disclosure/IR workflow"
else
  bad "SECURITY.md does not link docs/security/vulnerability-disclosure-and-incident-response.md"
fi

if [[ -f .github/ISSUE_TEMPLATE/config.yml ]] && grep -qiF "security" .github/ISSUE_TEMPLATE/config.yml; then
  ok "issue-template config surfaces a security reporting link"
else
  bad "add a security reporting contact_link to .github/ISSUE_TEMPLATE/config.yml"
fi

echo
if [[ "$fail" -ne 0 ]]; then
  echo "RESULT: FAIL" >&2
  exit 1
fi
echo "RESULT: PASS"
exit 0
