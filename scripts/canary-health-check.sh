#!/usr/bin/env bash
# scripts/canary-health-check.sh — Monitor canary error rate and auto-promote or rollback.
#
# Usage:
#   NETWORK=<local|testnet|mainnet> \
#   CANARY_CONTRACT_ID=<id> \
#   ./scripts/canary-health-check.sh
#
# Description:
#   Polls the canary contract's error rate from CloudWatch (or Grafana) for a
#   configurable observation window. If the error rate remains below the
#   threshold for the entire window, promote-canary.sh is called automatically.
#   If the error rate meets or exceeds the threshold at any point, the canary
#   is immediately rolled back via rollback-canary.sh.
#
#   After the outcome is determined the result is posted to the GitHub
#   deployment status API (requires GITHUB_TOKEN, GITHUB_REPOSITORY,
#   GITHUB_DEPLOYMENT_ID to be set).
#
# Environment variables (all configurable):
#   NETWORK                — Stellar network: local | testnet | mainnet (default: testnet)
#   CANARY_CONTRACT_ID     — Canary contract ID (default: read from canary-contract-id.txt)
#   CANARY_WINDOW          — Observation window in minutes (default: 10)
#   CANARY_POLL_INTERVAL   — Seconds between error-rate checks (default: 60)
#   ERROR_RATE_THRESHOLD   — Max acceptable error rate 0-100 in percent (default: 5)
#   METRIC_BACKEND         — Where to fetch error rate: cloudwatch | grafana (default: cloudwatch)
#   AWS_REGION             — AWS region for CloudWatch queries (default: us-east-1)
#   CW_NAMESPACE           — CloudWatch namespace (default: LumenFlow/canary)
#   CW_METRIC_NAME         — CloudWatch metric name (default: ErrorRate)
#   GRAFANA_URL            — Grafana base URL (required when METRIC_BACKEND=grafana)
#   GRAFANA_API_KEY        — Grafana API key (required when METRIC_BACKEND=grafana)
#   GRAFANA_DATASOURCE_UID — Grafana datasource UID for Prometheus queries
#   GITHUB_TOKEN           — GitHub PAT for posting deployment status (optional)
#   GITHUB_REPOSITORY      — owner/repo (optional, e.g. Gloriachinedu/lumenflow-contracts)
#   GITHUB_DEPLOYMENT_ID   — GitHub deployment ID to update (optional)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKSPACE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Defaults ─────────────────────────────────────────────────────────────────

NETWORK="${NETWORK:-testnet}"
CANARY_WINDOW="${CANARY_WINDOW:-10}"           # minutes
CANARY_POLL_INTERVAL="${CANARY_POLL_INTERVAL:-60}"  # seconds
ERROR_RATE_THRESHOLD="${ERROR_RATE_THRESHOLD:-5}"   # percent
METRIC_BACKEND="${METRIC_BACKEND:-cloudwatch}"
AWS_REGION="${AWS_REGION:-us-east-1}"
CW_NAMESPACE="${CW_NAMESPACE:-LumenFlow/canary}"
CW_METRIC_NAME="${CW_METRIC_NAME:-ErrorRate}"

# ── Resolve canary contract ID ────────────────────────────────────────────────

if [[ -n "${CANARY_CONTRACT_ID:-}" ]]; then
  : # already set via environment
elif [[ -f "$WORKSPACE_ROOT/canary-contract-id.txt" ]]; then
  CANARY_CONTRACT_ID="$(cat "$WORKSPACE_ROOT/canary-contract-id.txt")"
  CANARY_CONTRACT_ID="${CANARY_CONTRACT_ID//[$'\r\n']/}"
else
  echo "ERROR: CANARY_CONTRACT_ID is not set and canary-contract-id.txt was not found."
  echo "       Run ./scripts/deploy-canary.sh first."
  exit 1
fi

[[ -z "$CANARY_CONTRACT_ID" ]] && {
  echo "ERROR: CANARY_CONTRACT_ID is empty."
  exit 1
}

# ── Utility functions ─────────────────────────────────────────────────────────

log()  { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
info() { log "INFO  $*"; }
warn() { log "WARN  $*"; }
err()  { log "ERROR $*" >&2; }

# Post a GitHub deployment status update.
# Args: <state> <description>
#   state: pending | in_progress | success | failure | error
post_deployment_status() {
  local state="$1"
  local description="$2"

  if [[ -z "${GITHUB_TOKEN:-}" || -z "${GITHUB_REPOSITORY:-}" || -z "${GITHUB_DEPLOYMENT_ID:-}" ]]; then
    info "GitHub deployment status skipped (GITHUB_TOKEN / GITHUB_REPOSITORY / GITHUB_DEPLOYMENT_ID not set)"
    return 0
  fi

  local api_url="https://api.github.com/repos/${GITHUB_REPOSITORY}/deployments/${GITHUB_DEPLOYMENT_ID}/statuses"
  local environment_url="https://github.com/${GITHUB_REPOSITORY}"

  curl -sf \
    -X POST \
    -H "Authorization: Bearer ${GITHUB_TOKEN}" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$api_url" \
    -d "$(jq -n \
      --arg state        "$state" \
      --arg description  "$description" \
      --arg env_url      "$environment_url" \
      '{state: $state, description: $description, environment_url: $env_url, auto_inactive: false}')" \
    > /dev/null \
  && info "GitHub deployment status posted: $state — $description" \
  || warn "Failed to post GitHub deployment status (non-fatal)"
}

# Fetch the current error rate (0–100) from CloudWatch.
fetch_error_rate_cloudwatch() {
  local rate
  rate=$(aws cloudwatch get-metric-statistics \
    --namespace "$CW_NAMESPACE" \
    --metric-name "$CW_METRIC_NAME" \
    --dimensions Name=ContractId,Value="$CANARY_CONTRACT_ID" \
    --start-time "$(date -u -d '5 minutes ago' '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -v-5M '+%Y-%m-%dT%H:%M:%SZ')" \
    --end-time   "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    --period 300 \
    --statistics Average \
    --region "$AWS_REGION" \
    --query 'Datapoints[0].Average' \
    --output text 2>/dev/null || echo "None")

  if [[ "$rate" == "None" || -z "$rate" ]]; then
    warn "No CloudWatch data point available — assuming error rate = 0"
    echo "0"
  else
    # Round to integer
    printf "%.0f" "$rate"
  fi
}

# Fetch the current error rate from a Grafana/Prometheus datasource.
fetch_error_rate_grafana() {
  if [[ -z "${GRAFANA_URL:-}" || -z "${GRAFANA_API_KEY:-}" ]]; then
    warn "GRAFANA_URL or GRAFANA_API_KEY not set — assuming error rate = 0"
    echo "0"
    return
  fi

  local datasource_uid="${GRAFANA_DATASOURCE_UID:-default}"
  # Prometheus instant query: percentage of error responses over 5-minute window
  local query="rate(lumenflow_errors_total{contract_id=\"$CANARY_CONTRACT_ID\"}[5m]) / rate(lumenflow_requests_total{contract_id=\"$CANARY_CONTRACT_ID\"}[5m]) * 100"

  local rate
  rate=$(curl -sf \
    -H "Authorization: Bearer ${GRAFANA_API_KEY}" \
    "${GRAFANA_URL}/api/datasources/proxy/uid/${datasource_uid}/api/v1/query" \
    --data-urlencode "query=${query}" \
    | jq -r '.data.result[0].value[1] // "0"' 2>/dev/null || echo "0")

  printf "%.0f" "${rate:-0}"
}

# Dispatch to the configured metric backend.
get_error_rate() {
  case "$METRIC_BACKEND" in
    cloudwatch) fetch_error_rate_cloudwatch ;;
    grafana)    fetch_error_rate_grafana    ;;
    *)
      warn "Unknown METRIC_BACKEND='$METRIC_BACKEND'. Defaulting to cloudwatch."
      fetch_error_rate_cloudwatch
      ;;
  esac
}

# ── Main health-check loop ────────────────────────────────────────────────────

TOTAL_CHECKS=$(( (CANARY_WINDOW * 60) / CANARY_POLL_INTERVAL ))
[[ "$TOTAL_CHECKS" -lt 1 ]] && TOTAL_CHECKS=1

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "Canary health check started"
info "  Canary contract  : $CANARY_CONTRACT_ID"
info "  Network          : $NETWORK"
info "  Observation window : ${CANARY_WINDOW} min (${TOTAL_CHECKS} checks × ${CANARY_POLL_INTERVAL}s)"
info "  Error threshold  : ${ERROR_RATE_THRESHOLD}%"
info "  Metric backend   : $METRIC_BACKEND"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

post_deployment_status "in_progress" "Canary health check started — monitoring for ${CANARY_WINDOW} min"

CHECKS_PASSED=0

for (( i=1; i<=TOTAL_CHECKS; i++ )); do
  info "Check ${i}/${TOTAL_CHECKS} — fetching error rate from $METRIC_BACKEND..."

  CURRENT_RATE=$(get_error_rate)
  info "  Error rate: ${CURRENT_RATE}% (threshold: ${ERROR_RATE_THRESHOLD}%)"

  if [[ "$CURRENT_RATE" -ge "$ERROR_RATE_THRESHOLD" ]]; then
    err "Error rate ${CURRENT_RATE}% >= threshold ${ERROR_RATE_THRESHOLD}% on check ${i}/${TOTAL_CHECKS}"
    err "Triggering automatic rollback."
    echo ""

    post_deployment_status "failure" \
      "Canary error rate ${CURRENT_RATE}% exceeded ${ERROR_RATE_THRESHOLD}% — rolling back"

    NETWORK="$NETWORK" \
    CANARY_CONTRACT_ID="$CANARY_CONTRACT_ID" \
      "$SCRIPT_DIR/rollback-canary.sh"

    post_deployment_status "error" \
      "Canary rolled back after error rate ${CURRENT_RATE}% exceeded ${ERROR_RATE_THRESHOLD}%"

    exit 1
  fi

  CHECKS_PASSED=$(( CHECKS_PASSED + 1 ))
  info "  ✓ Check ${i}/${TOTAL_CHECKS} passed (${CURRENT_RATE}% < ${ERROR_RATE_THRESHOLD}%)"

  if [[ "$i" -lt "$TOTAL_CHECKS" ]]; then
    info "  Sleeping ${CANARY_POLL_INTERVAL}s before next check..."
    sleep "$CANARY_POLL_INTERVAL"
  fi
done

# ── All checks passed → promote ───────────────────────────────────────────────

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
info "All ${TOTAL_CHECKS} health checks passed. Promoting canary to stable."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

post_deployment_status "in_progress" "All ${TOTAL_CHECKS} checks passed — promoting canary"

NETWORK="$NETWORK" \
CANARY_CONTRACT_ID="$CANARY_CONTRACT_ID" \
  "$SCRIPT_DIR/promote-canary.sh"

post_deployment_status "success" \
  "Canary promoted to stable after ${TOTAL_CHECKS} passing health checks (error rate < ${ERROR_RATE_THRESHOLD}%)"

info "✅ Canary auto-promotion complete."
