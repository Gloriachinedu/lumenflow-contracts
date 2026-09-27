#!/usr/bin/env bash
# scripts/terraform-drift-check.sh — Local Terraform drift detection
#
# Resolves: #852
#
# Runs `terraform plan -detailed-exitcode`, saves the plan artifact, and
# reports whether the live infrastructure has drifted from the Terraform state.
#
# Usage:
#   ./scripts/terraform-drift-check.sh [environment]
#   ./scripts/terraform-drift-check.sh dev
#   ./scripts/terraform-drift-check.sh prod
#
# Requirements: terraform >= 1.6, AWS credentials in env or ~/.aws

set -euo pipefail

ENVIRONMENT="${1:-dev}"
TF_DIR="$(dirname "$0")/../infra/terraform"
ARTIFACT_DIR="$(dirname "$0")/../.terraform-artifacts"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
PLAN_FILE="$ARTIFACT_DIR/plan-${ENVIRONMENT}-${TIMESTAMP}.txt"
PLAN_BINARY="$ARTIFACT_DIR/plan-${ENVIRONMENT}-${TIMESTAMP}.binary"

info()    { echo "[INFO]  $*"; }
success() { echo "[OK]    $*"; }
warn()    { echo "[WARN]  $*" >&2; }
error()   { echo "[ERROR] $*" >&2; }

# ── Preflight ──────────────────────────────────────────────────────────────────

if ! command -v terraform &>/dev/null; then
  error "terraform not found. Install it from https://developer.hashicorp.com/terraform/install"
  exit 1
fi

TF_ACTUAL_VERSION="$(terraform version -json 2>/dev/null | python3 -c 'import sys,json; print(json.load(sys.stdin)["terraform_version"])' 2>/dev/null || terraform version | head -1 | grep -oP '\d+\.\d+\.\d+')"
info "Terraform version: $TF_ACTUAL_VERSION"

mkdir -p "$ARTIFACT_DIR"

# ── Init ───────────────────────────────────────────────────────────────────────

info "Initialising Terraform in $TF_DIR ..."
(cd "$TF_DIR" && terraform init -input=false -no-color -reconfigure 2>&1) || {
  error "terraform init failed. Check backend config and AWS credentials."
  exit 1
}

# ── Plan ───────────────────────────────────────────────────────────────────────

info "Running terraform plan for environment='$ENVIRONMENT' ..."

PLAN_EXIT=0
(
  cd "$TF_DIR"
  terraform plan \
    -input=false \
    -no-color \
    -detailed-exitcode \
    -var="environment=$ENVIRONMENT" \
    -out="$PLAN_BINARY" \
    2>&1 | tee "$PLAN_FILE"
) || PLAN_EXIT=$?

# ── Interpret exit codes ───────────────────────────────────────────────────────

# -detailed-exitcode: 0 = no changes, 1 = error, 2 = changes present

echo ""
case "$PLAN_EXIT" in
  0)
    success "No drift detected. Infrastructure matches Terraform state."
    DRIFT_STATUS="clean"
    ;;
  1)
    error "Terraform plan returned an error. Review output above."
    exit 1
    ;;
  2)
    warn "DRIFT DETECTED: Infrastructure has changes pending."
    DRIFT_STATUS="drifted"
    ;;
  *)
    error "Unexpected exit code from terraform plan: $PLAN_EXIT"
    exit 1
    ;;
esac

# ── Parse summary ──────────────────────────────────────────────────────────────

PLAN_LINE=$(grep -E "^Plan: [0-9]+ to add" "$PLAN_FILE" 2>/dev/null || echo "Plan: 0 to add, 0 to change, 0 to destroy.")
ADDS=$(echo "$PLAN_LINE"     | grep -oP '\d+(?= to add)'     || echo "0")
CHANGES=$(echo "$PLAN_LINE"  | grep -oP '\d+(?= to change)'  || echo "0")
DESTROYS=$(echo "$PLAN_LINE" | grep -oP '\d+(?= to destroy)' || echo "0")

echo ""
echo "============================================"
echo "  Terraform Drift Report"
echo "  Environment: $ENVIRONMENT"
echo "  Status:      $DRIFT_STATUS"
echo "--------------------------------------------"
echo "  To add:      $ADDS"
echo "  To change:   $CHANGES"
echo "  To destroy:  $DESTROYS"
echo "============================================"

if [[ "$DESTROYS" -gt 0 ]]; then
  warn "⚠️  $DESTROYS resource(s) will be DESTROYED if you apply this plan."
  warn "    Review the plan carefully before running terraform apply."
fi

echo ""
echo "Artifacts saved:"
echo "  Plan text:   $PLAN_FILE"
echo "  Plan binary: $PLAN_BINARY"
echo ""
echo "To apply: cd $TF_DIR && terraform apply $PLAN_BINARY"

[[ "$DRIFT_STATUS" == "drifted" ]] && exit 2 || exit 0
