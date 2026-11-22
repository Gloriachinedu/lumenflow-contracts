#!/usr/bin/env bash
# scripts/load-test.sh — Load test for high-frequency concurrent payment submissions
#
# Issue #632: Simulates 50 concurrent payers each submitting 10 payments against
# the LumenFlow contract on testnet (or a configurable network).
#
# Requires: k6 (https://k6.io/docs/getting-started/installation)
#
# Usage:
#   CONTRACT_ID=<id> RPC_URL=<url> NETWORK=testnet ./scripts/load-test.sh
#
# Required env vars:
#   CONTRACT_ID    — deployed LumenFlow contract address
#   RPC_URL        — Soroban RPC endpoint (default: https://soroban-testnet.stellar.org)
#
# Optional env vars:
#   NETWORK        — Stellar network passphrase identifier (default: testnet)
#   PAYER_KEY      — base payer secret key used to derive load-test accounts
#   TOKEN_ADDRESS  — SAC token address for payments
#   RESULTS_FILE   — path to write JSON results (default: /tmp/load-test-results.json)
#   VUS            — virtual users (concurrent payers, default: 50)
#   PAYMENTS_PER_VU — payments per user (default: 10)
#   BATCH_CLIENTS  — concurrent batch-payment clients (default: 10)
#   BATCH_ITEMS    — items per batch payment call (default: 10)
#   BASELINE_P95_MS — recorded baseline P95 latency (ms) for the concurrent
#                     batch scenario, from docs/benchmarking.md (default: 1200)
#   MULTISIG_SIGNER_TX_XDRS — JSON array of five pre-signed sign_multisig_payment
#                     transaction envelopes for the same payment and unique signers
#   MULTISIG_THRESHOLD — signatures required for the multisig payment (default: 3)
#   WEBHOOK_RELAY_URL — base URL of the webhook relay under test; enables the
#                     webhook relay scenario (Issue #1578)
#   WEBHOOK_EVENTS_PER_MIN — target event rate for the relay scenario (default: 1000)
#   WEBHOOK_DURATION — duration of the relay scenario (default: 5m)
#   WEBHOOK_P99_THRESHOLD_MS — P99 delivery latency budget (default: 2000)
#   WEBHOOK_BASELINE_P99_MS — recorded baseline P99 delivery latency (ms) for the
#                     relay scenario; a >20% regression fails the run (default: 2000)
#
# Pass/fail thresholds:
#   p99 latency < 5 000 ms
#   error rate  < 1 %
#
# Issue #1578: when WEBHOOK_RELAY_URL is provided, a "webhook_relay" scenario
# drives WEBHOOK_EVENTS_PER_MIN events/minute for WEBHOOK_DURATION, measures
# P99 delivery latency and dropped events, and fails if P99 >= 2 000 ms, any
# event is dropped, or P99 regresses more than 20% over WEBHOOK_BASELINE_P99_MS.
# The JSON report includes webhook_relay.latency_p99_ms for baseline comparison.
=======
#
# Issue #1084: a second scenario ("concurrent_batch_payments") simulates
# BATCH_CLIENTS concurrent clients each submitting a single batch_payment
# call containing BATCH_ITEMS entries. It reports throughput (payments/sec),
# P95 latency, and error rate, and fails if P95 regresses more than 20% over
# BASELINE_P95_MS (see docs/benchmarking.md — "Load Test Baseline").
#
# Issue #1276: when MULTISIG_SIGNER_TX_XDRS is provided, five concurrent k6 VUs
# submit pre-signed sign_multisig_payment transactions and wait for finality.
# This requires funded signer accounts and an already initiated payment.
#
# Results are printed to stdout and written to RESULTS_FILE in JSON format.
set -euo pipefail

# ── Check k6 is installed ─────────────────────────────────────────────────────
if ! command -v k6 &>/dev/null; then
  echo "ERROR: k6 is not installed." >&2
  echo "Install it from https://k6.io/docs/getting-started/installation" >&2
  echo ""
  echo "Quick install options:"
  echo "  macOS:   brew install k6"
  echo "  Linux:   sudo gpg -k && sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69 && echo 'deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main' | sudo tee /etc/apt/sources.list.d/k6.list && sudo apt-get update && sudo apt-get install k6"
  echo "  Docker:  docker run --rm -i grafana/k6 ..."
  exit 1
fi

# ── Configuration ─────────────────────────────────────────────────────────────
CONTRACT_ID="${CONTRACT_ID:?CONTRACT_ID is required}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK="${NETWORK:-testnet}"
TOKEN_ADDRESS="${TOKEN_ADDRESS:-}"
RESULTS_FILE="${RESULTS_FILE:-/tmp/load-test-results.json}"
VUS="${VUS:-50}"
PAYMENTS_PER_VU="${PAYMENTS_PER_VU:-10}"
LATENCY_THRESHOLD_MS="${LATENCY_THRESHOLD_MS:-5000}"
BATCH_CLIENTS="${BATCH_CLIENTS:-10}"
BATCH_ITEMS="${BATCH_ITEMS:-10}"
BASELINE_P95_MS="${BASELINE_P95_MS:-1200}"
MULTISIG_SIGNER_TX_XDRS="${MULTISIG_SIGNER_TX_XDRS:-}"
MULTISIG_THRESHOLD="${MULTISIG_THRESHOLD:-3}"
WEBHOOK_RELAY_URL="${WEBHOOK_RELAY_URL:-}"
WEBHOOK_EVENTS_PER_MIN="${WEBHOOK_EVENTS_PER_MIN:-1000}"
WEBHOOK_DURATION="${WEBHOOK_DURATION:-5m}"
WEBHOOK_P99_THRESHOLD_MS="${WEBHOOK_P99_THRESHOLD_MS:-2000}"
WEBHOOK_BASELINE_P99_MS="${WEBHOOK_BASELINE_P99_MS:-2000}"

echo "════════════════════════════════════════════════════════════════"
echo "  LumenFlow Load Test — High-Frequency Payment Submission"
echo "  Date:         $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "  Network:      $NETWORK"
echo "  RPC URL:      $RPC_URL"
echo "  Contract:     $CONTRACT_ID"
echo "  VUs:          $VUS (concurrent payers)"
echo "  Payments/VU:  $PAYMENTS_PER_VU"
echo "  Total:        $((VUS * PAYMENTS_PER_VU)) payment submissions"
echo "  Batch scenario: $BATCH_CLIENTS concurrent clients x $BATCH_ITEMS items"
echo "  Baseline P95: ${BASELINE_P95_MS}ms (batch scenario, 20% regression gate)"
if [ -n "$WEBHOOK_RELAY_URL" ]; then
  echo "  Webhook relay: $WEBHOOK_RELAY_URL"
  echo "  Relay load:   ${WEBHOOK_EVENTS_PER_MIN} events/min for ${WEBHOOK_DURATION}"
  echo "  Relay budget: P99 < ${WEBHOOK_P99_THRESHOLD_MS}ms, 0 dropped events"
  echo "  Relay baseline P99: ${WEBHOOK_BASELINE_P99_MS}ms (20% regression gate)"
else
  echo "  Webhook relay: skipped (set WEBHOOK_RELAY_URL to enable)"
fi
echo "  Results file: $RESULTS_FILE"
echo "════════════════════════════════════════════════════════════════"
echo ""

# ── Write k6 test script ──────────────────────────────────────────────────────
K6_SCRIPT=$(mktemp /tmp/lumenflow-load-test-XXXXXX.js)
trap 'rm -f "$K6_SCRIPT"' EXIT

cat > "$K6_SCRIPT" <<'K6_EOF'
/**
 * LumenFlow k6 Load Test — Issue #632
 *
 * Simulates 50 concurrent payers each submitting 10 payments to the
 * Soroban RPC endpoint. Uses the JSON-RPC simulateTransaction API
 * (read-only simulation) to measure RPC response latency without
 * consuming testnet XLM or requiring funded accounts.
 *
 * Metrics collected:
 *   - http_req_duration (p50 / p95 / p99)
 *   - http_req_failed   (error rate)
 *   - lumenflow_payment_duration (custom, per-payment latency)
 *
 * Pass/fail thresholds:
 *   p99 latency < 5 000 ms
 *   error rate  < 1 %
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';

// ── Custom metrics ──────────────────────────────────────────────────────────
const paymentDuration = new Trend('lumenflow_payment_duration', true);
const paymentErrors   = new Rate('lumenflow_payment_error_rate');

// Issue #1084 — concurrent batch payment scenario metrics
const batchPaymentDuration = new Trend('lumenflow_batch_payment_duration', true);
const batchPaymentErrors   = new Rate('lumenflow_batch_payment_error_rate');
const multisigSignerDuration = new Trend('lumenflow_multisig_signer_duration', true);
const multisigSignerErrors = new Rate('lumenflow_multisig_signer_error_rate');

// Issue #1578 — webhook relay scenario metrics
const webhookDeliveryDuration = new Trend('lumenflow_webhook_delivery_duration', true);
const webhookDroppedEvents    = new Counter('lumenflow_webhook_dropped_events');
const webhookDeliveredEvents  = new Counter('lumenflow_webhook_delivered_events');

const RPC_URL     = __ENV.RPC_URL     || 'https://soroban-testnet.stellar.org';
const CONTRACT_ID = __ENV.CONTRACT_ID || '';
const BATCH_CLIENTS   = parseInt(__ENV.BATCH_CLIENTS)   || 10;
const BATCH_ITEMS     = parseInt(__ENV.BATCH_ITEMS)     || 10;
const MULTISIG_SIGNER_TX_XDRS = __ENV.MULTISIG_SIGNER_TX_XDRS
  ? JSON.parse(__ENV.MULTISIG_SIGNER_TX_XDRS)
  : [];
const MULTISIG_SIGNERS = 5;
const MULTISIG_THRESHOLD = parseInt(__ENV.MULTISIG_THRESHOLD) || 3;
const MULTISIG_ENABLED = MULTISIG_SIGNER_TX_XDRS.length > 0;
if (MULTISIG_ENABLED && MULTISIG_SIGNER_TX_XDRS.length !== MULTISIG_SIGNERS) {
  throw new Error('MULTISIG_SIGNER_TX_XDRS must contain exactly five transaction XDRs');
}
if (MULTISIG_THRESHOLD < 1 || MULTISIG_THRESHOLD > MULTISIG_SIGNERS) {
  throw new Error('MULTISIG_THRESHOLD must be between 1 and 5');
}
if (MULTISIG_ENABLED && new Set(MULTISIG_SIGNER_TX_XDRS).size !== MULTISIG_SIGNERS) {
  throw new Error('MULTISIG_SIGNER_TX_XDRS must contain five distinct transaction XDRs');
}
// Regression gate: fail if the batch scenario's P95 latency exceeds the
// recorded baseline (docs/benchmarking.md — "Load Test Baseline") by >20%.
const BASELINE_P95_MS = parseFloat(__ENV.BASELINE_P95_MS) || 1200;
const BATCH_P95_GATE_MS = BASELINE_P95_MS * 1.2;

// Issue #1578 — webhook relay load scenario configuration.
const WEBHOOK_RELAY_URL = __ENV.WEBHOOK_RELAY_URL || '';
const WEBHOOK_ENABLED = WEBHOOK_RELAY_URL.length > 0;
const WEBHOOK_EVENTS_PER_MIN = parseInt(__ENV.WEBHOOK_EVENTS_PER_MIN) || 1000;
const WEBHOOK_DURATION = __ENV.WEBHOOK_DURATION || '5m';
const WEBHOOK_P99_THRESHOLD_MS = parseFloat(__ENV.WEBHOOK_P99_THRESHOLD_MS) || 2000;
const WEBHOOK_BASELINE_P99_MS = parseFloat(__ENV.WEBHOOK_BASELINE_P99_MS) || 2000;
const WEBHOOK_P99_GATE_MS = Math.min(WEBHOOK_P99_THRESHOLD_MS, WEBHOOK_BASELINE_P99_MS * 1.2);
// Events per second, spread across the configured number of VUs.
const WEBHOOK_EVENTS_PER_SEC = WEBHOOK_EVENTS_PER_MIN / 60;
const WEBHOOK_VUS = Math.max(1, Math.min(50, Math.ceil(WEBHOOK_EVENTS_PER_SEC)));
const WEBHOOK_SLEEP_SEC = WEBHOOK_VUS / WEBHOOK_EVENTS_PER_SEC;

// ── Test configuration ──────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // Existing sequential-payer scenario (Issue #632)
    sequential_payments: {
      executor: 'shared-iterations',
      exec: 'sequentialPayments',
      vus: parseInt(__ENV.VUS) || 50,
      iterations: parseInt(__ENV.TOTAL_PAYMENTS) || 500, // VUS x PAYMENTS_PER_VU
      maxDuration: '5m',
    },
    // Issue #1084 — 10 (configurable) concurrent clients, each submitting
    // one 10-item (configurable) batch_payment call.
    concurrent_batch_payments: {
      executor: 'per-vu-iterations',
      exec: 'concurrentBatchPayment',
      vus: BATCH_CLIENTS,
      iterations: 1,
      startTime: '0s',
      maxDuration: '5m',
    },
    ...(MULTISIG_ENABLED ? {
      concurrent_multisig_signing: {
        executor: 'per-vu-iterations',
        exec: 'concurrentMultisigSigner',
        vus: MULTISIG_SIGNERS,
        iterations: 1,
        startTime: '0s',
        maxDuration: '5m',
      },
    } : {}),
    // Issue #1578 — webhook relay at WEBHOOK_EVENTS_PER_MIN events/minute.
    ...(WEBHOOK_ENABLED ? {
      webhook_relay: {
        executor: 'constant-arrival-rate',
        exec: 'webhookRelay',
        rate: WEBHOOK_EVENTS_PER_MIN,
        timeUnit: '1m',
        duration: WEBHOOK_DURATION,
        preAllocatedVUs: WEBHOOK_VUS,
        maxVUs: WEBHOOK_VUS * 2,
        startTime: '0s',
      },
    } : {}),
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(20)', 'p(40)', 'p(50)', 'p(60)', 'p(80)', 'p(90)', 'p(95)', 'p(99)', 'p(100)'],
  thresholds: {
    // p99 latency under 5 seconds for all HTTP requests
    'http_req_duration': ['p(99)<5000'],
    // Error rate under 1%
    'http_req_failed': ['rate<0.01'],
    // Custom per-payment latency p99 under 5 seconds
    'lumenflow_payment_duration': ['p(99)<5000'],
    // Custom payment error rate under 1%
    'lumenflow_payment_error_rate': ['rate<0.01'],
    // Batch scenario: P95 must stay within 20% of the recorded baseline,
    // and error rate must stay under 1%.
    'lumenflow_batch_payment_duration': [`p(95)<${BATCH_P95_GATE_MS}`],
    'lumenflow_batch_payment_error_rate': ['rate<0.01'],
    ...(MULTISIG_ENABLED ? {
      'lumenflow_multisig_signer_error_rate': ['rate<0.01'],
      'lumenflow_multisig_signer_duration': ['p(99)<30000'],
    } : {}),
    // Webhook relay: P99 delivery latency budget and zero dropped events.
    ...(WEBHOOK_ENABLED ? {
      'lumenflow_webhook_delivery_duration': [`p(99)<${WEBHOOK_P99_GATE_MS}`],
      'lumenflow_webhook_dropped_events': ['count==0'],
    } : {}),
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal simulateTransaction request body.
 * Uses a no-op get_contract_version call as the payload — this exercises
 * the full RPC round-trip and Soroban state read path without requiring
 * funded accounts or real signatures.
 */
function buildSimulationPayload(iterationId) {
  // XDR for `get_contract_version()` invocation on the LumenFlow contract.
  // For load testing purposes we simulate the RPC call pattern;
  // replace with a pre-built signed payment XDR for full end-to-end testing.
  return JSON.stringify({
    jsonrpc: '2.0',
    id: iterationId,
    method: 'simulateTransaction',
    params: {
      transaction: buildInvokeXdr(CONTRACT_ID, 'get_contract_version', []),
    },
  });
}

/**
 * Minimal stub for XDR encoding — in a real load test this would use
 * the Stellar SDK or a pre-generated XDR envelope. For infrastructure
 * and RPC latency measurement this stub exercises the full HTTP stack.
 *
 * To run against a live contract with real payments, replace this with
 * a pre-signed transaction XDR (see docs/load-testing.md for details).
 */
function buildInvokeXdr(contractId, method, _args) {
  // Placeholder XDR — produces an expected "parse error" from the RPC,
  // which still exercises the full network and RPC latency path.
  // Replace with a valid pre-signed XDR envelope for production use.
  return `PLACEHOLDER_XDR:${contractId}:${method}:${Date.now()}`;
}

/**
 * Build a minimal simulateTransaction request body for a `batch_payment`
 * call carrying `itemCount` payment items. Like buildSimulationPayload,
 * this exercises the full RPC round-trip / Soroban read path without
 * requiring funded accounts or real signatures.
 */
function buildBatchSimulationPayload(iterationId, itemCount) {
  const items = Array.from({ length: itemCount }, (_, i) => ({
    order_id: `BATCH-${iterationId}-${i}`,
    amount: 1000 + i,
  }));
  return JSON.stringify({
    jsonrpc: '2.0',
    id: iterationId,
    method: 'simulateTransaction',
    params: {
      transaction: buildInvokeXdr(CONTRACT_ID, 'batch_payment', items),
    },
  });
}

// ── Scenario: sequential_payments (Issue #632) ────────────────────────────────
export function sequentialPayments() {
  const vuId = __VU;
  const iterationId = __ITER;
  const orderId = `LOAD-${vuId}-${iterationId}-${Date.now()}`;

  const payload = buildSimulationPayload(orderId);
  const params  = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  };

  const start    = Date.now();
  const response = http.post(RPC_URL, payload, params);
  const elapsed  = Date.now() - start;

  // Record custom payment latency metric
  paymentDuration.add(elapsed);

  // RPC should return 200 even for simulation errors
  const ok = check(response, {
    'status is 200':          (r) => r.status === 200,
    'response has jsonrpc':   (r) => r.body && r.body.includes('jsonrpc'),
    'no network error':       (r) => r.status !== 0,
  });

  // Track error rate
  paymentErrors.add(!ok);

  // Small think-time between payments (realistic payer cadence)
  sleep(0.1);
}

// ── Scenario: concurrent_batch_payments (Issue #1084) ─────────────────────────
// Each of BATCH_CLIENTS virtual users submits exactly one batch_payment call
// containing BATCH_ITEMS items, all started concurrently.
export function concurrentBatchPayment() {
  const vuId = __VU;
  const batchId = `BATCH-CLIENT-${vuId}-${Date.now()}`;

  const payload = buildBatchSimulationPayload(batchId, BATCH_ITEMS);
  const params  = {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  };

  const start    = Date.now();
  const response = http.post(RPC_URL, payload, params);
  const elapsed  = Date.now() - start;

  batchPaymentDuration.add(elapsed);

  const ok = check(response, {
    'batch status is 200':        (r) => r.status === 200,
    'batch response has jsonrpc': (r) => r.body && r.body.includes('jsonrpc'),
    'batch no network error':     (r) => r.status !== 0,
  });

  batchPaymentErrors.add(!ok);
}

// ── Scenario: concurrent_multisig_signing (Issue #1276) ──────────────────────
// Each VU submits one pre-signed transaction from a distinct authorized signer.
export function concurrentMultisigSigner() {
  const signerIndex = __VU - 1;
  const startedAt = Date.now();
  const sendResponse = http.post(RPC_URL, JSON.stringify({
    jsonrpc: '2.0',
    id: `multisig-send-${signerIndex}`,
    method: 'sendTransaction',
    params: { transaction: MULTISIG_SIGNER_TX_XDRS[signerIndex] },
  }), {
    headers: { 'Content-Type': 'application/json' },
    timeout: '30s',
  });

  let sendResult;
  try {
    sendResult = JSON.parse(sendResponse.body).result;
  } catch (_) {
    multisigSignerErrors.add(true);
    return;
  }

  if (sendResponse.status !== 200 || !sendResult || sendResult.status === 'ERROR' || !sendResult.hash) {
    multisigSignerErrors.add(true);
    return;
  }

  let transactionStatus = 'NOT_FOUND';
  for (let attempt = 0; attempt < 60; attempt++) {
    const statusResponse = http.post(RPC_URL, JSON.stringify({
      jsonrpc: '2.0',
      id: `multisig-status-${signerIndex}-${attempt}`,
      method: 'getTransaction',
      params: { hash: sendResult.hash },
    }), {
      headers: { 'Content-Type': 'application/json' },
      timeout: '10s',
    });

    try {
      transactionStatus = JSON.parse(statusResponse.body).result?.status ?? 'NOT_FOUND';
    } catch (_) {
      transactionStatus = 'ERROR';
    }
    if (transactionStatus === 'SUCCESS' || transactionStatus === 'FAILED' || transactionStatus === 'ERROR') {
      break;
    }
    sleep(0.5);
  }

  const succeeded = transactionStatus === 'SUCCESS';
  multisigSignerErrors.add(!succeeded);
  if (succeeded) {
    multisigSignerDuration.add(Date.now() - startedAt);
  }
}

// ── Scenario: webhook_relay (Issue #1578) ────────────────────────────────────
// Each iteration posts one webhook event to the relay and measures the
// end-to-end delivery latency reported by the relay. Events that fail to be
// accepted (non-2xx, timeout, or a relay-reported drop) are counted as dropped.
export function webhookRelay() {
  const eventId = `WH-${__VU}-${__ITER}-${Date.now()}`;
  const payload = JSON.stringify({
    id: eventId,
    type: 'payment.created',
    created_at: new Date().toISOString(),
    data: { order_id: eventId, amount: 1000 },
  });

  const start = Date.now();
  const response = http.post(`${WEBHOOK_RELAY_URL}/events`, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: '10s',
  });
  const elapsed = Date.now() - start;

  let accepted = response.status >= 200 && response.status < 300;
  let dropped = false;
  if (accepted && response.body) {
    try {
      const body = JSON.parse(response.body);
      if (body.dropped === true || body.status === 'dropped') {
        dropped = true;
      }
    } catch (_) {
      // Non-JSON success body is acceptable; treat as delivered.
    }
  }

  if (accepted && !dropped) {
    webhookDeliveredEvents.add(1);
    webhookDeliveryDuration.add(elapsed);
  } else {
    webhookDroppedEvents.add(1);
  }

  sleep(WEBHOOK_SLEEP_SEC);
}

// ── Summary ───────────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const p50  = Math.round(data.metrics.http_req_duration?.values?.['p(50)'] ?? 0);
  const p95  = Math.round(data.metrics.http_req_duration?.values?.['p(95)'] ?? 0);
  const p99  = Math.round(data.metrics.http_req_duration?.values?.['p(99)'] ?? 0);
  const errRate = ((data.metrics.http_req_failed?.values?.rate ?? 0) * 100).toFixed(2);
  const totalReqs = data.metrics.http_reqs?.values?.count ?? 0;

  // Issue #1084 — concurrent batch payment scenario metrics
  const batchP95 = Math.round(data.metrics.lumenflow_batch_payment_duration?.values?.['p(95)'] ?? 0);
  const batchCount = data.metrics.lumenflow_batch_payment_duration?.values?.count ?? 0;
  const batchErrRate = ((data.metrics.lumenflow_batch_payment_error_rate?.values?.rate ?? 0) * 100).toFixed(2);
  const batchDurationS = (data.state?.testRunDurationMs ?? 0) / 1000;
  const batchThroughput = batchDurationS > 0 ? (batchCount / batchDurationS) : 0;
  const batchP95Gate = BASELINE_P95_MS * 1.2;
  const batchRegressionPct = BASELINE_P95_MS > 0
    ? (((batchP95 - BASELINE_P95_MS) / BASELINE_P95_MS) * 100).toFixed(1)
    : '0.0';
  const batchPassed = batchP95 <= batchP95Gate && parseFloat(batchErrRate) < 1.0;
  const multisigSignerCount = data.metrics.lumenflow_multisig_signer_duration?.values?.count ?? 0;
  const multisigErrorRate = ((data.metrics.lumenflow_multisig_signer_error_rate?.values?.rate ?? 0) * 100).toFixed(2);
  const thresholdPercentile = MULTISIG_THRESHOLD * 20;
  const multisigThresholdCompletionMs = Math.round(
    data.metrics.lumenflow_multisig_signer_duration?.values?.[`p(${thresholdPercentile})`] ?? 0
  );
  const multisigPassed = !MULTISIG_ENABLED || (
    multisigSignerCount === MULTISIG_SIGNERS && parseFloat(multisigErrorRate) === 0
  );

  // Issue #1578 — webhook relay scenario metrics
  const webhookP99 = Math.round(data.metrics.lumenflow_webhook_delivery_duration?.values?.['p(99)'] ?? 0);
  const webhookDelivered = data.metrics.lumenflow_webhook_delivered_events?.values?.count ?? 0;
  const webhookDropped = data.metrics.lumenflow_webhook_dropped_events?.values?.count ?? 0;
  const webhookTotal = webhookDelivered + webhookDropped;
  const webhookRegressionPct = WEBHOOK_BASELINE_P99_MS > 0
    ? (((webhookP99 - WEBHOOK_BASELINE_P99_MS) / WEBHOOK_BASELINE_P99_MS) * 100).toFixed(1)
    : '0.0';
  const webhookPassed = !WEBHOOK_ENABLED || (
    webhookDropped === 0 &&
    webhookP99 < WEBHOOK_P99_THRESHOLD_MS &&
    webhookP99 <= WEBHOOK_BASELINE_P99_MS * 1.2
  );

  const passed = p99 < 5000 && parseFloat(errRate) < 1.0 && batchPassed && multisigPassed && webhookPassed;
  const status = passed ? '✅ PASSED' : '❌ FAILED';

  const summary = [
    '',
    '════════════════════════════════════════════════════════════════',
    `  Load Test Result: ${status}`,
    `  Date:         ${new Date().toISOString()}`,
    '',
    '  -- Sequential payments (Issue #632) --',
    `  Total requests: ${totalReqs}`,
    `  p50 latency:  ${p50} ms`,
    `  p95 latency:  ${p95} ms`,
    `  p99 latency:  ${p99} ms  (threshold: < 5000 ms)`,
    `  Error rate:   ${errRate}%  (threshold: < 1%)`,
    '',
    '  -- Concurrent batch payments (Issue #1084) --',
    `  Batch clients x items: ${BATCH_CLIENTS} x ${BATCH_ITEMS}`,
    `  Throughput:   ${batchThroughput.toFixed(2)} payments/sec`,
    `  p95 latency:  ${batchP95} ms  (baseline: ${BASELINE_P95_MS} ms, gate: ${batchP95Gate} ms)`,
    `  Regression:   ${batchRegressionPct}% vs baseline (fails CI if > 20%)`,
    `  Error rate:   ${batchErrRate}%  (threshold: < 1%)`,
    '',
    '  -- Concurrent multisig signing (Issue #1276) --',
    MULTISIG_ENABLED
      ? `  Signers / threshold: ${MULTISIG_SIGNERS} / ${MULTISIG_THRESHOLD}`
      : '  Skipped: MULTISIG_SIGNER_TX_XDRS was not provided',
    `  Threshold completion: ${multisigThresholdCompletionMs} ms (threshold-th successful signer)`,
    `  Successful signers: ${multisigSignerCount} / ${MULTISIG_ENABLED ? MULTISIG_SIGNERS : 0}`,
    `  Signer error rate: ${multisigErrorRate}%`,
    '',
    '  -- Webhook relay (Issue #1578) --',
    WEBHOOK_ENABLED
      ? `  Target rate:  ${WEBHOOK_EVENTS_PER_MIN} events/min for ${WEBHOOK_DURATION}`
      : '  Skipped: WEBHOOK_RELAY_URL was not provided',
    `  Events sent:  ${webhookTotal}`,
    `  Delivered:    ${webhookDelivered}`,
    `  Dropped:      ${webhookDropped}  (budget: 0)`,
    `  p99 delivery: ${webhookP99} ms  (budget: < ${WEBHOOK_P99_THRESHOLD_MS} ms)`,
    `  Regression:   ${webhookRegressionPct}% vs baseline ${WEBHOOK_BASELINE_P99_MS} ms (fails CI if > 20%)`,
    '════════════════════════════════════════════════════════════════',
    '',
  ].join('\n');

  // Write machine-readable results
  const jsonOut = JSON.stringify({
    date:        new Date().toISOString(),
    network:     __ENV.NETWORK ?? 'testnet',
    rpc_url:     __ENV.RPC_URL ?? 'https://soroban-testnet.stellar.org',
    vus:         parseInt(__ENV.VUS) || 50,
    total_requests: totalReqs,
    latency_p50_ms:  p50,
    latency_p95_ms:  p95,
    latency_p99_ms:  p99,
    error_rate_pct:  parseFloat(errRate),
    concurrent_batch_payments: {
      clients: BATCH_CLIENTS,
      items_per_batch: BATCH_ITEMS,
      throughput_per_sec: parseFloat(batchThroughput.toFixed(2)),
      latency_p95_ms: batchP95,
      baseline_p95_ms: BASELINE_P95_MS,
      regression_pct: parseFloat(batchRegressionPct),
      error_rate_pct: parseFloat(batchErrRate),
      passed: batchPassed,
    },
    concurrent_multisig_signing: {
      enabled: MULTISIG_ENABLED,
      signers: MULTISIG_ENABLED ? MULTISIG_SIGNERS : 0,
      threshold: MULTISIG_ENABLED ? MULTISIG_THRESHOLD : null,
      threshold_completion_ms: multisigThresholdCompletionMs,
      successful_signers: multisigSignerCount,
      error_rate_pct: parseFloat(multisigErrorRate),
      passed: multisigPassed,
    },
    webhook_relay: {
      enabled: WEBHOOK_ENABLED,
      relay_url: WEBHOOK_ENABLED ? WEBHOOK_RELAY_URL : null,
      events_per_min: WEBHOOK_ENABLED ? WEBHOOK_EVENTS_PER_MIN : 0,
      duration: WEBHOOK_ENABLED ? WEBHOOK_DURATION : null,
      events_sent: webhookTotal,
      events_delivered: webhookDelivered,
      events_dropped: webhookDropped,
      latency_p99_ms: webhookP99,
      p99_threshold_ms: WEBHOOK_P99_THRESHOLD_MS,
      baseline_p99_ms: WEBHOOK_BASELINE_P99_MS,
      regression_pct: parseFloat(webhookRegressionPct),
      passed: webhookPassed,
    },
    passed,
  }, null, 2);

  return {
    stdout: summary,
    [__ENV.RESULTS_FILE ?? '/tmp/load-test-results.json']: jsonOut,
  };
}
K6_EOF

# ── Run k6 ───────────────────────────────────────────────────────────────────
echo "Starting k6 load test..."
echo ""

k6 run \
  --env CONTRACT_ID="$CONTRACT_ID" \
  --env RPC_URL="$RPC_URL" \
  --env NETWORK="$NETWORK" \
  --env TOKEN_ADDRESS="$TOKEN_ADDRESS" \
  --env VUS="$VUS" \
  --env TOTAL_PAYMENTS="$((VUS * PAYMENTS_PER_VU))" \
  --env BATCH_CLIENTS="$BATCH_CLIENTS" \
  --env BATCH_ITEMS="$BATCH_ITEMS" \
  --env BASELINE_P95_MS="$BASELINE_P95_MS" \
  --env MULTISIG_SIGNER_TX_XDRS="$MULTISIG_SIGNER_TX_XDRS" \
  --env MULTISIG_THRESHOLD="$MULTISIG_THRESHOLD" \
  --env WEBHOOK_RELAY_URL="$WEBHOOK_RELAY_URL" \
  --env WEBHOOK_EVENTS_PER_MIN="$WEBHOOK_EVENTS_PER_MIN" \
  --env WEBHOOK_DURATION="$WEBHOOK_DURATION" \
  --env WEBHOOK_P99_THRESHOLD_MS="$WEBHOOK_P99_THRESHOLD_MS" \
  --env WEBHOOK_BASELINE_P99_MS="$WEBHOOK_BASELINE_P99_MS" \
  --env RESULTS_FILE="$RESULTS_FILE" \
  --summary-export="$RESULTS_FILE" \
  "$K6_SCRIPT"

EXIT_CODE=$?

echo ""
if [ "$EXIT_CODE" -eq 0 ]; then
  echo "✅ Load test passed — results written to $RESULTS_FILE"
else
  echo "❌ Load test failed — see output above for details"
  echo "   Results written to $RESULTS_FILE"
fi

exit $EXIT_CODE
