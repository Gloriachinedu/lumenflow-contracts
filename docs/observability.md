# LumenFlow Observability — Dashboards, Alerts, and On-Call Ownership

This document describes the full observability stack for LumenFlow in production: what dashboards exist, which panels to watch, how alerts are configured and routed, and who owns on-call response for each alert category.

For the raw monitoring setup (exporter, Prometheus, and Grafana import steps), see [docs/monitoring.md](monitoring.md).  
For event payload schemas, see [docs/events-reference.md](events-reference.md).

---

## Architecture Overview

```
Stellar Network
      │
      ▼
Horizon SSE (/contracts/{id}/events)
      │
      ▼
monitoring/lumenflow_exporter.py   ← scrapes every 30 s, persists cursor
      │  exposes :9101/metrics
      ▼
Prometheus
      │
      ├─── Grafana (dashboards + alert rules)
      └─── Alertmanager (routing → PagerDuty / Slack / email)
```

The exporter is the single source of truth between Horizon and the rest of the stack. It resumes from a persisted cursor file (`.lumenflow_cursor`) so no events are missed across restarts.

---

## Grafana Dashboards

The pre-built dashboard is at `monitoring/grafana-dashboard.json`. Import it via  
**Grafana → Dashboards → Import → Upload JSON file**.

### Dashboard: LumenFlow Contract Health

| Panel | Metric | What to watch |
|-------|--------|---------------|
| Total Payments | `lumenflow_payments_total` | Should increase steadily during business hours |
| Total Refunds | `lumenflow_refunds_total` | Spike above baseline may indicate a merchant dispute |
| Refunds Initiated | `lumenflow_refunds_initiated_total` | High ratio vs. executed refunds suggests approval bottleneck |
| Contract Status | `lumenflow_contract_paused` | **Must be 0** in production; 1 = contract paused |
| Active Merchants | `lumenflow_active_merchants` | Unexpected drops indicate admin deactivation or a bug |
| Error Rate (5 m) | `rate(lumenflow_errors_total[5m])` | Baseline near 0; any sustained rate warrants investigation |
| Payments / hour | `rate(lumenflow_payments_total[1h])` | Used to detect volume anomalies |
| Refunds / hour | `rate(lumenflow_refunds_total[1h])` | Used to detect refund-wave attacks |
| Avg Payment Amount | `rate(lumenflow_payment_amount_sum[5m]) / rate(lumenflow_payment_amount_count[5m])` | Sudden large spike may correlate with `suspicious_activity` events |
| Error Rate (time-series) | `rate(lumenflow_errors_total[5m])` | Long-tail view for root-cause analysis |
| Scrape Health | `lumenflow_scrape_errors_total`, `lumenflow_last_scrape_timestamp_seconds` | Exporter connectivity; alert if stale |
| Build Info | `lumenflow_build_info{version,commit}` | Deployed release/commit; value is always `1`. Populated from `LUMENFLOW_VERSION` / `LUMENFLOW_COMMIT` injected by the deploy pipeline. Use to confirm which build is live. |

### Dashboard: LumenFlow Refund Lifecycle

A supplementary view focused on refund state transitions, useful during dispute-resolution investigations.

| Panel | PromQL | Purpose |
|-------|--------|---------|
| Initiated vs Executed | `lumenflow_refunds_initiated_total - lumenflow_refunds_total` | Pending refund backlog |
| Refund Approval Rate | `lumenflow_refunds_total / lumenflow_refunds_initiated_total` | Low rate = merchant not executing approved refunds |
| Window Expiry Risk | Derived from `paid_at` timestamps in event data | Refunds at risk of expiring within 48 h |

> This dashboard is not shipped in the JSON file yet. Track progress in [docs/backlog.md](backlog.md).

---

## Alert Rules

Three alert rules are embedded in `monitoring/grafana-dashboard.json` and evaluated by Grafana's built-in alerting engine. The table below is the authoritative specification — if the JSON diverges from this table, update the JSON.

### Tier 1 — Critical (page immediately)

| Alert name | PromQL condition | For duration | Severity | Runbook |
|------------|-----------------|--------------|----------|---------|
| `LumenFlowContractPaused` | `lumenflow_contract_paused == 1` | 1 min | Critical | [Runbook: Contract Paused](#runbook-contract-paused) |
| `LumenFlowHighErrorRate` | `rate(lumenflow_errors_total[5m]) / rate(lumenflow_payments_total[5m]) > 0.05` | 5 min | Critical | [Runbook: High Error Rate](#runbook-high-error-rate) |
| `LumenFlowExporterDown` | `absent(lumenflow_last_scrape_timestamp_seconds)` | 5 min | Critical | [Runbook: Exporter Down](#runbook-exporter-down) |

### Tier 2 — Warning (notify, no page)

| Alert name | PromQL condition | For duration | Severity | Runbook |
|------------|-----------------|--------------|----------|---------|
| `LumenFlowPaymentVolumeDrop` | `rate(lumenflow_payments_total[1h]) < 0.5 * rate(lumenflow_payments_total[1h] offset 1h)` | 15 min | Warning | [Runbook: Volume Drop](#runbook-payment-volume-drop) |
| `LumenFlowSuspiciousActivity` | `increase(lumenflow_errors_total[5m]) > 0` | — (immediate) | Warning | [Runbook: Suspicious Activity](#runbook-suspicious-activity) |
| `LumenFlowRefundBacklogHigh` | `lumenflow_refunds_initiated_total - lumenflow_refunds_total > 50` | 30 min | Warning | [Runbook: Refund Backlog](#runbook-refund-backlog) |
| `LumenFlowStaleExporter` | `time() - lumenflow_last_scrape_timestamp_seconds > 120` | 5 min | Warning | [Runbook: Exporter Down](#runbook-exporter-down) |

### Adding a new alert rule

1. Add the PromQL rule in Grafana under **Alerting → Alert rules → New alert rule**.
2. Set the evaluation interval to match the `for` duration in the table above.
3. Assign it to the correct **Contact point** (see [Notification Routing](#notification-routing) below).
4. Export the updated dashboard JSON (`monitoring/grafana-dashboard.json`) and commit it.
5. Update the alert table in this document.

---

## Notification Routing

Configure contact points in **Grafana → Alerting → Contact points**.

| Contact point | Channel | Used for |
|---------------|---------|----------|
| `pagerduty-critical` | PagerDuty integration key | All Tier-1 Critical alerts |
| `slack-alerts` | `#lumenflow-alerts` Slack channel | All Tier-2 Warning alerts |
| `email-oncall` | on-call team distribution list | Fallback for all alerts |

Notification policy (Grafana → **Alerting → Notification policies**):

```
Root policy:
  └─ matchers: severity=critical  →  contact: pagerduty-critical
  └─ matchers: severity=warning   →  contact: slack-alerts
  └─ default                      →  contact: email-oncall
```

---

## On-Call Ownership

| Alert category | Primary on-call team | Escalation path |
|----------------|---------------------|-----------------|
| Contract paused / unpaused | Smart Contract Team | → Core Maintainers |
| High error rate / suspicious activity | Smart Contract Team + DevOps Team | → Core Maintainers |
| Exporter / Prometheus down | DevOps Team | → Core Maintainers |
| Payment volume drop | DevOps Team | → Smart Contract Team |
| Refund backlog | Smart Contract Team | → Core Maintainers |
| Infrastructure / Terraform | DevOps Team | → Core Maintainers |

GitHub team handles for review requests and incident pings:

- Smart Contract Team: `@Gloriachinedu/smart-contract-team`
- DevOps Team: `@Gloriachinedu/devops-team`
- Documentation Team: `@Gloriachinedu/documentation-team`

---

## Runbooks

### Runbook: Contract Paused

**Alert:** `LumenFlowContractPaused`  
**Impact:** All `process_payment_with_signature`, `batch_payment`, `execute_refund`, and multi-sig calls fail with `ContractPaused`.

**Steps:**
1. Check the Grafana **Contract Status** panel — confirm `lumenflow_contract_paused == 1`.
2. Check Horizon for a recent `lumenflow/contract_paused` event to determine who paused it and why.
3. If the pause was intentional (e.g., security incident): follow the [security incident response](../SECURITY.md) procedure.
4. If the pause was accidental or the incident is resolved: an admin calls `unpause_contract`. Verify the `lumenflow/contract_unpaused` event appears in Horizon.
5. Confirm `lumenflow_contract_paused` returns to `0` in Grafana within two scrape intervals (≤ 60 s).
6. Close the PagerDuty incident and post a brief RCA to `#lumenflow-incidents`.

---

### Runbook: High Error Rate

**Alert:** `LumenFlowHighErrorRate`  
**Impact:** > 5% of payment attempts are triggering `lumenflow/suspicious_activity` events, or the exporter is mis-classifying errors.

**Steps:**
1. Open the **Error Rate (time-series)** panel in Grafana to identify when the rate spiked.
2. Query Horizon for recent `suspicious_activity` events:
   ```bash
   curl "$HORIZON/contracts/$CONTRACT_ID/events?order=desc&limit=50" | \
     jq '.[] | select(.topic[1] == "suspicious_activity")'
   ```
3. Inspect the `reason` field in the event data (`LargePayment`, `RapidRefunds`, or `ManyAuthFailures`).
4. If `LargePayment`: check whether the threshold (`set_large_payment_threshold`) needs adjusting.
5. If `RapidRefunds` or `ManyAuthFailures`: possible fraud or integration bug — escalate to Smart Contract Team immediately.
6. If the error source is the exporter itself (`lumenflow_scrape_errors_total` is rising), see [Runbook: Exporter Down](#runbook-exporter-down).

---

### Runbook: Exporter Down

**Alert:** `LumenFlowExporterDown` or `LumenFlowStaleExporter`  
**Impact:** Metrics and dashboard data are stale; no new alerts will fire until the exporter recovers.

**Steps:**
1. SSH into the monitoring host and check the exporter process:
   ```bash
   systemctl status lumenflow-exporter
   # or
   docker ps | grep lumenflow-exporter
   ```
2. Check logs for the error:
   ```bash
   journalctl -u lumenflow-exporter -n 100
   ```
3. Common causes and fixes:
   - **Horizon unreachable**: verify `HORIZON_URL` is correct and the host has outbound connectivity.
   - **Invalid `CONTRACT_ID`**: verify against the deployed contract address.
   - **Cursor file corrupt**: delete `.lumenflow_cursor` to reset (events will re-play from the beginning, causing duplicate counts — use `VALIDATE=1` replay script to reconcile).
   - **Python dependency missing**: re-run `pip install prometheus_client requests`.
4. Restart the exporter after resolving:
   ```bash
   systemctl restart lumenflow-exporter
   ```
5. Confirm `lumenflow_last_scrape_timestamp_seconds` updates within 60 s.

---

### Runbook: Payment Volume Drop

**Alert:** `LumenFlowPaymentVolumeDrop`  
**Impact:** Payment throughput has dropped ≥ 50% compared to the same window one hour ago. May indicate a Horizon outage, network issue, or a critical upstream integration failure.

**Steps:**
1. Check Horizon status at https://status.stellar.org — if Horizon is degraded, wait for recovery.
2. Check the **Scrape Health** panel — confirm the exporter is running and up to date.
3. If Horizon is healthy, check the contract is not paused (`lumenflow_contract_paused == 0`).
4. Review the last 30 minutes of `lumenflow/payment_processed` events to confirm the drop is real (not a scrape artefact).
5. If confirmed: notify Smart Contract Team and check for recent deployments or config changes that could block payments.

---

### Runbook: Suspicious Activity

**Alert:** `LumenFlowSuspiciousActivity`  
**Impact:** At least one `lumenflow/suspicious_activity` event has fired in the past 5 minutes.

**Steps:**
1. Retrieve the event details:
   ```bash
   curl "$HORIZON/contracts/$CONTRACT_ID/events?order=desc&limit=10" | \
     jq '.[] | select(.topic[1] == "suspicious_activity") | .value'
   ```
2. Identify `reason`, `actor`, and `value` in the event payload.
3. For `LargePayment`: check whether the actor is a known merchant; if not, escalate to Smart Contract Team.
4. For `ManyAuthFailures`: possible brute-force attack against signature verification — escalate immediately and consider pausing the contract (`pause_contract`) if the rate is sustained.
5. Document the incident in the internal security log.

---

### Runbook: Refund Backlog

**Alert:** `LumenFlowRefundBacklogHigh`  
**Impact:** More than 50 refunds have been initiated but not yet executed. Merchants may not be processing approvals.

**Steps:**
1. Use the replay script to enumerate pending refunds:
   ```bash
   CONTRACT_ID=<id> ./scripts/replay-events.sh
   sqlite3 replay-db-*.sqlite "SELECT refund_id, order_id, amount FROM refunds WHERE status = 'Pending';"
   ```
2. Identify which merchants have the most open refunds.
3. Contact the merchant(s) via their `contact_info` and remind them to call `execute_refund` on approved refunds.
4. If a refund is approaching the 30-day window expiry, prioritise escalation.

---

## Key Metrics Reference

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `lumenflow_payments_total` | Counter | — | Total `payment_processed` events |
| `lumenflow_refunds_total` | Counter | — | Total `refund_executed` events |
| `lumenflow_refunds_initiated_total` | Counter | — | Total `refund_initiated` events |
| `lumenflow_errors_total` | Counter | — | Total `suspicious_activity` events |
| `lumenflow_merchants_registered_total` | Counter | — | Total `merchant_registered` events |
| `lumenflow_multisig_executed_total` | Counter | — | Total `multisig_executed` events |
| `lumenflow_payment_amount` | Histogram | — | Payment amounts in stroops |
| `lumenflow_active_merchants` | Gauge | — | Running count of active merchants |
| `lumenflow_contract_paused` | Gauge | — | `1` = paused, `0` = active |
| `lumenflow_last_scrape_timestamp_seconds` | Gauge | — | Unix timestamp of last successful Horizon poll |
| `lumenflow_scrape_errors_total` | Counter | — | Number of failed Horizon fetches |

All metrics are exposed at `http://<exporter-host>:9101/metrics` in Prometheus text format.

---

## Extending Observability

### Adding a new metric

1. Add the metric definition to `monitoring/lumenflow_exporter.py` using the `prometheus_client` library.
2. Map the corresponding LumenFlow event (`lumenflow/<event_name>`) to the new metric in the `handle_event` function.
3. Add a panel for the metric to `monitoring/grafana-dashboard.json` (export from Grafana UI → overwrite the file).
4. Update the metrics reference table in this document.
5. If the metric warrants an alert, add the rule to the [Alert Rules](#alert-rules) section and implement it in Grafana.

### Adding a new dashboard panel

1. Open Grafana and edit the **LumenFlow Contract Health** dashboard.
2. Add the panel with the desired PromQL expression.
3. Save the dashboard and re-export the JSON to `monitoring/grafana-dashboard.json`.
4. Commit the updated JSON alongside any documentation changes.

---

## Further Reading

- [docs/monitoring.md](monitoring.md) — Horizon SSE setup, exporter configuration, and event replay
- [docs/events-reference.md](events-reference.md) — full event payload schemas
- [SECURITY.md](../SECURITY.md) — responsible disclosure and incident escalation
- [Stellar Horizon API](https://developers.stellar.org/docs/data/horizon/api-reference/resources/events)
- [Grafana Alerting documentation](https://grafana.com/docs/grafana/latest/alerting/)
