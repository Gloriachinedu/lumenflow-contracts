#!/usr/bin/env bash
# scripts/validate-secrets.sh — Validate required deployment secrets locally.
#
# Resolves: #850
#
# Usage:
#   ./scripts/validate-secrets.sh testnet
#   ./scripts/validate-secrets.sh mainnet
#
# Sources .env if present, then checks that each required secret is set and
# has the right format. Exit code 0 means all checks passed.

set -euo pipefail

ENVIRONMENT="${1:-testnet}"

info()    { echo "[INFO]  $*"; }
success() { echo "[OK]    $*"; }
warn()    { echo "[WARN]  $*"; }
error()   { echo "[ERROR] $*" >&2; }

FAILURES=0

# ── Secret manager configuration (issue #1547) ────────────────────────────────
# When SECRET_MANAGER is set (aws|vault), secrets are expected to come from the
# secret manager rather than .env. Rotation uses dual-active versions: the
# current version and the previous version overlap for ROTATION_OVERLAP_MINUTES
# (default 15) before the old version is deactivated.
SECRET_MANAGER="${SECRET_MANAGER:-}"
ROTATION_OVERLAP_MINUTES="${ROTATION_OVERLAP_MINUTES:-15}"
EXPECTED_OVERLAP_MINUTES=15

# ── Source .env if present ─────────────────────────────────────────────────────
if [[ -f ".env" ]]; then
  info "Sourcing .env..."
  # shellcheck disable=SC1091
  set -o allexport
  # shellcheck source=/dev/null
  source ".env"
  set +o allexport
fi

# Re-read secret manager settings in case .env defined them.
SECRET_MANAGER="${SECRET_MANAGER:-}"
ROTATION_OVERLAP_MINUTES="${ROTATION_OVERLAP_MINUTES:-15}"

# ── Helpers ────────────────────────────────────────────────────────────────────

check_secret() {
  local name="$1"
  local value="${!name:-}"
  local required="${2:-true}"

  if [[ -z "$value" ]]; then
    if [[ "$required" == "true" ]]; then
      error "Required secret '$name' is not set or is empty."
      FAILURES=$((FAILURES + 1))
    else
      warn "Optional secret '$name' is not set (non-blocking)."
    fi
  else
    success "$name is present (${#value} chars)"
  fi
}

validate_stellar_secret() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "$value" ]]; then
    return  # caught by check_secret
  fi

  # Stellar secret keys: 'S' followed by 55 uppercase base32 characters (A-Z, 2-7)
  if [[ ! "$value" =~ ^S[A-Z2-7]{55}$ ]]; then
    error "Secret '$name' does not look like a valid Stellar secret key."
    error "  Expected: S + 55 uppercase base32 chars (A-Z2-7), total 56 chars."
    error "  Got:      ${#value} chars starting with '${value:0:1}'"
    FAILURES=$((FAILURES + 1))
  else
    success "$name has valid Stellar secret key format"
  fi
}

validate_stellar_address() {
  local name="$1"
  local value="${!name:-}"

  if [[ -z "$value" ]]; then
    return  # caught by check_secret
  fi

  # Stellar public keys (addresses): 'G' followed by 55 uppercase base32 chars
  if [[ ! "$value" =~ ^G[A-Z2-7]{55}$ ]]; then
    error "Secret '$name' does not look like a valid Stellar public key (G + 55 base32 chars)."
    FAILURES=$((FAILURES + 1))
  else
    success "$name has valid Stellar address format"
  fi
}

# ── Secret manager / rotation helpers (issue #1547) ───────────────────────────

# Verify the secret manager is configured and reachable when enabled.
validate_secret_manager() {
  if [[ -z "$SECRET_MANAGER" ]]; then
    info "SECRET_MANAGER not set — using .env-based secrets (backward compatible)."
    return
  fi

  echo ""
  echo "--- Secret manager checks ---"

  case "$SECRET_MANAGER" in
    aws)
      if ! command -v aws >/dev/null 2>&1; then
        error "SECRET_MANAGER=aws but the AWS CLI ('aws') is not installed."
        FAILURES=$((FAILURES + 1))
        return
      fi
      success "AWS Secrets Manager selected (aws CLI available)"
      ;;
    vault)
      if ! command -v vault >/dev/null 2>&1; then
        error "SECRET_MANAGER=vault but the Vault CLI ('vault') is not installed."
        FAILURES=$((FAILURES + 1))
        return
      fi
      success "HashiCorp Vault selected (vault CLI available)"
      ;;
    *)
      error "Unknown SECRET_MANAGER '$SECRET_MANAGER'. Use 'aws' or 'vault'."
      FAILURES=$((FAILURES + 1))
      return
      ;;
  esac

  # Confirm the environment's secret path is configured.
  local path_var="SECRET_MANAGER_PATH"
  local path="${!path_var:-}"
  if [[ -z "$path" ]]; then
    error "SECRET_MANAGER is set but '$path_var' is empty."
    error "  Set it to the secret name/path, e.g. 'lumenflow/${ENVIRONMENT}/secrets'."
    FAILURES=$((FAILURES + 1))
  else
    success "$path_var is set ($path)"
  fi
}

# During the overlap window both the current and previous versions must be
# present so in-flight requests signed with the old secret still validate.
validate_rotation_overlap() {
  if [[ -z "$SECRET_MANAGER" ]]; then
    return
  fi

  echo ""
  echo "--- Rotation overlap checks ---"

  if [[ ! "$ROTATION_OVERLAP_MINUTES" =~ ^[0-9]+$ ]]; then
    error "ROTATION_OVERLAP_MINUTES must be an integer (got '$ROTATION_OVERLAP_MINUTES')."
    FAILURES=$((FAILURES + 1))
    return
  fi

  if [[ "$ROTATION_OVERLAP_MINUTES" -ne "$EXPECTED_OVERLAP_MINUTES" ]]; then
    error "ROTATION_OVERLAP_MINUTES must be $EXPECTED_OVERLAP_MINUTES (got $ROTATION_OVERLAP_MINUTES)."
    error "  The 15-minute overlap window is required for zero-downtime rollover."
    FAILURES=$((FAILURES + 1))
  else
    success "Rotation overlap window is ${ROTATION_OVERLAP_MINUTES} minutes"
  fi

  # Both versions must be present while the overlap window is active.
  local current_var="SECRET_CURRENT_VERSION"
  local previous_var="SECRET_PREVIOUS_VERSION"
  local current="${!current_var:-}"
  local previous="${!previous_var:-}"

  if [[ -z "$current" ]]; then
    error "Required '$current_var' is not set (latest secret version id)."
    FAILURES=$((FAILURES + 1))
  else
    success "$current_var is present ($current)"
  fi

  if [[ -z "$previous" ]]; then
    warn "'$previous_var' is not set — no overlap window active (fresh deploy)."
  elif [[ "$previous" == "$current" ]]; then
    error "'$previous_var' must differ from '$current_var' during rotation."
    FAILURES=$((FAILURES + 1))
  else
    success "$previous_var is present ($previous) — dual-active overlap"
  fi
}

# Ensure the deactivation schedule respects the 15-minute overlap window.
validate_deactivation_schedule() {
  if [[ -z "$SECRET_MANAGER" ]]; then
    return
  fi

  echo ""
  echo "--- Deactivation schedule checks ---"

  local sched_var="SECRET_DEACTIVATION_DELAY_MINUTES"
  local delay="${!sched_var:-}"

  if [[ -z "$delay" ]]; then
    warn "'$sched_var' is not set — defaulting to ${EXPECTED_OVERLAP_MINUTES} minutes."
    return
  fi

  if [[ ! "$delay" =~ ^[0-9]+$ ]]; then
    error "$sched_var must be an integer (got '$delay')."
    FAILURES=$((FAILURES + 1))
    return
  fi

  if [[ "$delay" -lt "$EXPECTED_OVERLAP_MINUTES" ]]; then
    error "$sched_var ($delay) is shorter than the required ${EXPECTED_OVERLAP_MINUTES}-minute overlap."
    error "  Old versions must stay active for at least ${EXPECTED_OVERLAP_MINUTES} minutes."
    FAILURES=$((FAILURES + 1))
  else
    success "Old version deactivated after ${delay} minutes (>= ${EXPECTED_OVERLAP_MINUTES})"
  fi
}

# ── Testnet validation ─────────────────────────────────────────────────────────

validate_testnet() {
  echo ""
  echo "=== Testnet Secret Validation ==="
  echo ""

  # Required
  check_secret "TESTNET_DEPLOYER_KEY"    "true"
  check_secret "TESTNET_ADMIN_KEY"       "true"
  check_secret "TESTNET_ADMIN_ADDRESS"   "true"

  # Optional (needed for smoke tests)
  check_secret "TESTNET_MERCHANT_KEY"     "false"
  check_secret "TESTNET_MERCHANT_ADDRESS" "false"
  check_secret "TESTNET_PAYER_KEY"        "false"
  check_secret "TESTNET_PAYER_ADDRESS"    "false"
  check_secret "TESTNET_TOKEN_ADDRESS"    "false"

  echo ""
  echo "--- Format checks ---"

  validate_stellar_secret "TESTNET_DEPLOYER_KEY"
  validate_stellar_secret "TESTNET_ADMIN_KEY"
  validate_stellar_address "TESTNET_ADMIN_ADDRESS"

  if [[ -n "${TESTNET_MERCHANT_KEY:-}" ]];     then validate_stellar_secret  "TESTNET_MERCHANT_KEY";     fi
  if [[ -n "${TESTNET_MERCHANT_ADDRESS:-}" ]]; then validate_stellar_address "TESTNET_MERCHANT_ADDRESS"; fi
  if [[ -n "${TESTNET_PAYER_KEY:-}" ]];        then validate_stellar_secret  "TESTNET_PAYER_KEY";        fi
  if [[ -n "${TESTNET_PAYER_ADDRESS:-}" ]];    then validate_stellar_address "TESTNET_PAYER_ADDRESS";    fi
}

# ── Mainnet validation ─────────────────────────────────────────────────────────

validate_mainnet() {
  echo ""
  echo "=== Mainnet Secret Validation ==="
  echo ""

  # Required
  check_secret "MAINNET_DEPLOYER_KEY"   "true"
  check_secret "MAINNET_ADMIN_KEY"      "true"
  check_secret "MAINNET_ADMIN_ADDRESS"  "true"
  check_secret "MAINNET_SOURCE_ACCOUNT" "true"

  echo ""
  echo "--- Format checks ---"

  validate_stellar_secret  "MAINNET_DEPLOYER_KEY"
  validate_stellar_secret  "MAINNET_ADMIN_KEY"
  validate_stellar_address "MAINNET_ADMIN_ADDRESS"
  validate_stellar_secret  "MAINNET_SOURCE_ACCOUNT"
}

# ── Main ───────────────────────────────────────────────────────────────────────

echo "============================================"
echo "  LumenFlow — Secret Validation"
echo "  Environment: $ENVIRONMENT"
echo "  Secret manager: ${SECRET_MANAGER:-.env}"
echo "============================================"

validate_secret_manager

case "$ENVIRONMENT" in
  testnet) validate_testnet ;;
  mainnet) validate_mainnet ;;
  *)
    error "Unknown environment: '$ENVIRONMENT'. Use 'testnet' or 'mainnet'."
    exit 1
    ;;
esac

validate_rotation_overlap
validate_deactivation_schedule

echo ""
echo "============================================"
if [[ "$FAILURES" -gt 0 ]]; then
  echo "  ❌ FAILED: $FAILURES check(s) did not pass."
  echo "============================================"
  echo ""
  echo "Add missing secrets to your .env file (for local use), configure the"
  echo "secret manager (SECRET_MANAGER=aws|vault), or add them to the"
  echo "GitHub repository secrets at:"
  echo "  Settings > Secrets and variables > Actions"
  echo ""
  echo "See docs/admin-key-rotation.md for the rotation runbook."
  exit 1
else
  echo "  ✅ All checks passed for '$ENVIRONMENT'."
  echo "============================================"
fi
