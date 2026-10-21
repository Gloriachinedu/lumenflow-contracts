# Payment Confirmation SLOs

Service Level Objectives for the LumenFlow payment confirmation pipeline.

These SLOs define the reliability targets that canary deployments and production
monitoring must maintain. The canary health check (`scripts/canary-health-check.sh`)
enforces these thresholds automatically during progressive rollout.

---

## SLO Definitions

| SLO | Metric | Target | Window |
|-----|--------|--------|--------|
| **Error Rate** | `lumenflow_payment_error_rate` | ≤ 1% | 5 minutes |
| **Confirmation Latency p95** | `lumenflow_payment_confirm_duration_seconds` (p95) | ≤ 30 s | 5 minutes |
| **Confirmation Latency p99** | `lumenflow_payment_confirm_duration_seconds` (p99) | ≤ 60 s | 5 minutes |
| **Availability** | HTTP 2xx rate on RPC endpoint | ≥ 99.5% | 5 minutes |

### Error Rate SLO (primary canary gate)

```
Error Rate = (failed_payments / total_payments) × 100
```

A "failed payment" is any call to `process_payment_with_signature` or
`batch_payment` that returns a non-zero contract error code during the
observation window.

**Threshold:** `CANARY_ERROR_RATE_THRESHOLD` (default `1.0` — i.e. 1%)

If the error rate exceeds this threshold during the 5-minute canary observation
window, the health check exits non-zero and triggers automatic rollback via
`scripts/rollback-canary.sh`.

---

## Prometheus Metrics

LumenFlow exports the following Prometheus-compatible metrics via the
sidecar metrics exporter (configured at `METRICS_URL`):

| Metric name | Type | Description |
|---|---|---|
| `lumenflow_payment_error_rate` | Gauge | Rolling error rate (%) over the last 5 min |
| `lumenflow_payment_confirm_duration_seconds` | Histogram | End-to-end payment confirmation latency |
| `lumenflow_rpc_request_total` | Counter | Total RPC calls, labelled by `status` |
| `lumenflow_rpc_error_total` | Counter | Total RPC errors |

### Sample PromQL queries

```promql
# 5-minute rolling error rate (%)
100 * (
  rate(lumenflow_rpc_error_total[5m])
  /
  rate(lumenflow_rpc_request_total[5m])
)

# p95 confirmation latency
histogram_quantile(0.95, rate(lumenflow_payment_confirm_duration_seconds_bucket[5m]))

# Availability (HTTP 2xx fraction)
rate(lumenflow_rpc_request_total{status=~"2.."}[5m])
/
rate(lumenflow_rpc_request_total[5m])
```

---

## Environment Variables (canary health check)

| Variable | Default | Description |
|---|---|---|
| `METRICS_URL` | *(required)* | Prometheus/Grafana metrics endpoint URL |
| `CANARY_ERROR_RATE_THRESHOLD` | `1.0` | Maximum acceptable error rate (%) |
| `CANARY_OBSERVE_SECONDS` | `300` | Observation window in seconds (5 min) |
| `CANARY_POLL_INTERVAL` | `30` | Poll interval in seconds |
| `ROLLBACK_SCRIPT` | `scripts/rollback-canary.sh` | Path to rollback script |

---

## Rollback Policy

If any canary health check poll returns an error rate above `CANARY_ERROR_RATE_THRESHOLD`:

1. The health check script logs the current metric value and the threshold.
2. It exits with code `1`.
3. The CI/CD pipeline invokes `scripts/rollback-canary.sh` automatically.
4. An alert is sent to the on-call channel (configured in the CI pipeline).

Human review is required before re-attempting a canary promotion after a rollback.

---

## References

- [Monitoring Guide](monitoring.md)
- [Deployment Guide](deployment-guide.md)
- [Deployment Environments](deployment-environments.md)
