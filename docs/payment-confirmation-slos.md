# Service-Level Objectives for Payment Confirmation and Webhooks

**Issue:** [#906](https://github.com/Gloriachinedu/lumenflow-contracts/issues/906)
**Status:** Backlog / Planning
**Priority:** Medium
**Effort:** Medium
**Labels:** product, Stellar Wave

---

## Overview

This document defines the service-level objectives (SLOs) that LumenFlow commits
to for two merchant-visible surfaces:

1. **Payment confirmation** — the time from a payer submitting a payment to the
   merchant being able to observe it as confirmed.
2. **Webhook delivery** — the time from a confirmed event to a successful webhook
   POST at the merchant endpoint, including retry behaviour.

It complements the operational guidance in
[observability.md](observability.md), [monitoring.md](monitoring.md), and
[webhook-integration.md](webhook-integration.md).

---

## Definitions

| Term | Meaning |
|---|---|
| **Confirmation latency** | `confirmed_at - submitted_at` for a payment, where `confirmed_at` is when the ledger entry is final and indexed |
| **Webhook delivery latency** | `first_2xx_at - event_created_at` for an event |
| **Delivery success** | Endpoint returned `2xx` within the retry budget |
| **Error budget** | `1 - SLO target`, measured over a rolling 30-day window |

---

## Service-Level Objectives

### Payment confirmation

| Objective | Target (rolling 30 days) |
|---|---|
| Confirmation latency p50 | ≤ 6 s |
| Confirmation latency p95 | ≤ 20 s |
| Confirmation latency p99 | ≤ 60 s |
| Confirmed payments never lost from history | 99.99% |

### Webhook delivery

| Objective | Target (rolling 30 days) |
|---|---|
| Delivery latency p50 (first attempt) | ≤ 5 s |
| Delivery latency p95 | ≤ 30 s |
| Events delivered within retry budget | 99.9% |
| Duplicate deliveries | ≤ 0.1% of events (at-least-once, dedup by `event_id`) |

### Retry budget

Exponential backoff with jitter: attempts at ~0s, 30s, 2m, 10m, 1h, 6h, then
hourly up to 24h total. After the budget is exhausted the event is marked
`undeliverable` and surfaced in the dashboard for manual replay.

---

## Measurement

- Latency is measured from server-side timestamps only; client clocks are not
  trusted.
- SLIs are emitted as histograms and counters via the existing metrics pipeline
  (`payment_confirmation_latency_seconds`, `webhook_delivery_latency_seconds`,
  `webhook_delivery_attempts_total{result}`).
- A dashboard panel and a burn-rate alert (2% budget in 1h, or 5% in 6h) are
  added per [monitoring.md](monitoring.md).

---

## Failure, Permission, and Boundary Cases

| Case | Expected behaviour |
|---|---|
| Ledger congestion pushes confirmation past p99 | Error budget consumed; burn-rate alert fires; no data loss |
| Merchant endpoint down for < 24h | Event delivered on a later retry; counts against latency, not success, if within budget |
| Merchant endpoint down for > 24h | Event `undeliverable`; excluded from latency SLO, counted against the delivery-success SLO |
| Merchant returns `2xx` but ignores payload | Treated as delivered; out of scope for the SLO |
| Clock skew / negative computed latency | Sample dropped and logged, not clamped to zero |
| Endpoint returns `410 Gone` | Deliveries stop immediately; event marked `endpoint_retired`, not counted as a failure |

---

## Testing

- Normal path: a confirmed payment emits a confirmation-latency sample and a
  webhook that succeeds on the first attempt records one delivery sample.
- Edge case: an endpoint failing twice then succeeding produces three
  `webhook_delivery_attempts_total` increments and one success within budget.
- Failure case: an endpoint failing for the full retry budget marks the event
  `undeliverable` and counts against the delivery-success SLO exactly once.

---

## Review Cadence

SLO targets are reviewed quarterly against actual performance. Changes require
product and operations sign-off and an update to this document and
[ROADMAP.md](../ROADMAP.md) if commitments change.
