#!/usr/bin/env bash
# scripts/canary-health-check.sh
#
# Canary deployment health check for LumenFlow.
#
# Monitors the payment error rate SLO defined in docs/payment-confirmation-slos.md
# by querying the Prometheus/Grafana metrics endpoint. Fails the canary if the
# error rate exceeds the configurable threshold during the observation window,
# which triggers automatic rollback via rollback-canary.sh.
#
# Usage:
#   METRICS_URL=https://metrics.example.com ./scripts/canary-health-check.sh
#
# Environment variables:
#   METRICS_URL                   — Prometheus/Grafana metrics endpoint (required)
#   CANARY_ERROR_RATE_THRESHOLD   — Max acceptable error rate in % (default: 1.0)
#   CANARY_OBSERVE_SECONDS        — Observation window in seconds   (default: 300)
#   CANARY_POLL_INTERVAL          — Poll interval in seconds        (default: 30)
#   ROLLBACK_SCRIPT               — Rollback script path (default: scripts/rollback-canary.sh)
#
# Exit codes:
#   0 — canary is healthy; error rate within SLO for the full observation window
#   1 — SLO breach detected; rollback triggered
#   2 — configuration error (missing required variable)
#   3 — unable to reach metrics endpoint after retries

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────

METRICS_URL="${METRICS_URL:-}"
CANARY_ERROR_RATE_THRESHOLD="${CANARY_ERROR_RATE_THRESHOLD:-1.0}"
CANARY_OBSERVE_SECONDS="${CANARY_OBSERVE_SECONDS:-300}"
CANARY_POLL_INTERVAL="${CANARY_POLL_INTERVAL:-30}"
ROLLBACK_SCRIPT="${ROLLBACK_SCRIPT:-scripts/rollback-canary.sh}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Helpers ───────────────────────────────────────────────────────────────────

log() {
  echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"
}

log_metric() {
  local label="$1"
  local value="$2"
  local threshold="$3"
  log "METRIC  ${label}=${value}%  threshold=${threshold}%"
}

usage() {
  cat <<EOF
Usage: METRICS_URL=<url> ./scripts/canary-health-check.sh

Required:
  METRICS_URL   Prometheus or Grafana metrics API endpoint.
                The endpoint must expose the metric:
                  lumenflow_payment_error_rate  (gauge, %)

Optional:
  CANARY_ERROR_RATE_THRESHOLD   Max error rate % before rollback (default: 1.0)
  CANARY_OBSERVE_SECONDS        Observation window in seconds    (default: 300)
  CANARY_POLL_INTERVAL          Seconds between polls            (default: 30)
  ROLLBACK_SCRIPT               Path to rollback script          (default: scripts/rollback-canary.sh)

See docs/payment-confirmation-slos.md for the full SLO definitions.
EOF
  exit 2
}

# ── Validation ────────────────────────────────────────────────────────────────

if [[ -z "$METRICS_URL" ]]; then
  log "ERROR: METRICS_URL is required."
  usage
fi

# ── Query error rate from metrics endpoint ─────────────────────────────────────
#
# Expects the endpoint to return a Prometheus instant query result:
#   GET $METRICS_URL/api/v1/query?query=lumenflow_payment_error_rate
#
# Response JSON (Prometheus HTTP API format):
#   { "status": "success", "data": { "result": [{ "value": ["<ts>", "<val>"] }] } }
#
# Returns the error rate as a decimal string (e.g. "0.42").

query_error_rate() {
  local url="${METRICS_URL%/}/api/v1/query"
  local query="lumenflow_payment_error_rate"
  local max_retries=3
  local attempt=0
  local response

  while (( attempt < max_retries )); do
    (( attempt++ ))
    response=$(curl --silent --fail --max-time 10 \
      "${url}?query=${query}" 2>/dev/null) && break || {
      log "WARN: metrics request attempt ${attempt}/${max_retries} failed."
      sleep 2
    }
  done

  if [[ -z "${response:-}" ]]; then
    log "ERROR: could not reach metrics endpoint after ${max_retries} attempts: ${METRICS_URL}"
    exit 3
  fi

  # Parse the value from Prometheus instant query response using python3 or jq
  if command -v jq &>/dev/null; then
    echo "$response" | jq -r '.data.result[0].value[1] // "0"'
  elif command -v python3 &>/dev/null; then
    echo "$response" | python3 -c "
import sys, json
data = json.load(sys.stdin)
results = data.get('data', {}).get('result', [])
print(results[0]['value'][1] if results else '0')
"
  else
    # Fallback: naive grep for the numeric value
    echo "$response" | grep -oP '"value":\["\d+(\.\d+)?","(\K[\d.]+)' | head -1 || echo "0"
  fi
}

# ── Rollback ──────────────────────────────────────────────────────────────────

trigger_rollback() {
  local error_rate="$1"
  log "SLO BREACH: error rate=${error_rate}% exceeds threshold=${CANARY_ERROR_RATE_THRESHOLD}%"
  log "ACTION: triggering automatic rollback via ${ROLLBACK_SCRIPT}"

  if [[ -x "${SCRIPT_DIR}/../${ROLLBACK_SCRIPT}" ]]; then
    "${SCRIPT_DIR}/../${ROLLBACK_SCRIPT}"
  elif [[ -x "${ROLLBACK_SCRIPT}" ]]; then
    "${ROLLBACK_SCRIPT}"
  else
    log "WARN: rollback script not found or not executable: ${ROLLBACK_SCRIPT}"
    log "      Rollback must be performed manually."
  fi

  exit 1
}

# ── bc-free float comparison (awk) ───────────────────────────────────────────

exceeds_threshold() {
  local rate="$1"
  local threshold="$2"
  awk -v r="$rate" -v t="$threshold" 'BEGIN { exit (r > t) ? 0 : 1 }'
}

# ── Main observation loop ─────────────────────────────────────────────────────

log "======================================================="
log "  LumenFlow Canary Health Check"
log "  SLO: error rate ≤ ${CANARY_ERROR_RATE_THRESHOLD}% over ${CANARY_OBSERVE_SECONDS}s window"
log "  Metrics endpoint: ${METRICS_URL}"
log "  Poll interval: ${CANARY_POLL_INTERVAL}s"
log "======================================================="

elapsed=0
poll_count=0

while (( elapsed < CANARY_OBSERVE_SECONDS )); do
  (( poll_count++ ))
  log "--- Poll #${poll_count} (elapsed ${elapsed}s / ${CANARY_OBSERVE_SECONDS}s) ---"

  error_rate=$(query_error_rate)
  log_metric "lumenflow_payment_error_rate" "${error_rate}" "${CANARY_ERROR_RATE_THRESHOLD}"

  if exceeds_threshold "${error_rate}" "${CANARY_ERROR_RATE_THRESHOLD}"; then
    trigger_rollback "${error_rate}"
  fi

  log "OK: error rate within SLO."

  sleep "${CANARY_POLL_INTERVAL}"
  (( elapsed += CANARY_POLL_INTERVAL ))
done

log "======================================================="
log "  RESULT: HEALTHY"
log "  Canary passed the full ${CANARY_OBSERVE_SECONDS}s observation window."
log "  All ${poll_count} polls reported error rate ≤ ${CANARY_ERROR_RATE_THRESHOLD}%."
log "======================================================="
exit 0
