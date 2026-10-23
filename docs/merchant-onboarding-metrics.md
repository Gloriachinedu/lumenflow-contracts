# Merchant Onboarding — Completion Metrics & Funnel Events

This document defines the **funnel model**, the **event catalogue**, and the
**completion metrics** for the merchant onboarding wizard
([`frontend/onboarding.html`](../frontend/onboarding.html)). It is the contract
between the wizard UI, any analytics sink a deployment plugs in, and the
dashboards and alerts built on top of the resulting data.

Instrumentation lives in
[`frontend/onboarding-analytics.js`](../frontend/onboarding-analytics.js).
The wizard emits events through that module; the module validates every payload,
strips PII, and forwards accepted events to a sink registered via
`OnboardingAnalytics.configure(fn)`. With **no sink configured the module is a
silent no-op** — onboarding works exactly as before and nothing is collected.

Related: [Merchant Onboarding Guide](merchant-onboarding.md) ·
[Monitoring Guide](monitoring.md) · [Events Reference](events-reference.md) ·
[Privacy Policy](../PRIVACY.md)

---

## 1. Funnel model

The wizard is a fixed 5‑step flow. Each step maps to one funnel **stage**:

| Step | Stage id | Entry event | Success exit |
|-----:|----------|-------------|--------------|
| 1 | `welcome` | `onboarding_started` | **Get Started** clicked |
| 2 | `wallet` | `onboarding_step_viewed` | wallet connected (real or demo) |
| 3 | `business_details` | `onboarding_step_viewed` | all fields valid, **Continue** |
| 4 | `review` | `onboarding_step_viewed` | **Register Merchant** submitted |
| 5 | `done` | `onboarding_completed` | terminal — profile is live |

A merchant is **onboarded** when they reach stage `done`, i.e. the
`onboarding_completed` event fires. Every earlier stage is a potential drop-off
point.

```
welcome ──► wallet ──► business_details ──► review ──► done
   │           │              │               │
   └───────────┴──────────────┴───────────────┴──►  abandoned / back
```

---

## 2. Event envelope

Every event shares this envelope (produced by `onboarding-analytics.js`):

| Field | Type | Notes |
|-------|------|-------|
| `schema_version` | integer | Currently `1`. Bumped on any breaking change to this catalogue. |
| `event` | string | One of the names in §3. Unknown names are dropped. |
| `funnel_id` | string | Random per-session id (`sessionStorage`), lets you stitch one merchant's journey without identifying them. Not linked to wallet, email, or IP by the client. |
| `t_since_start_s` | integer | Whole seconds since `onboarding_started`. Coarse by design. |
| `ts` | string | ISO‑8601 client timestamp. |
| `props` | object | Event-specific, allow-listed properties (§3). |

### Privacy guarantees enforced in code

- **No PII is ever emitted.** Wallet addresses, public keys, email addresses,
  business name, and description are on a deny-list; any property whose key
  matches is stripped before dispatch.
- **Enum properties are validated** against fixed sets (`provider`, `stage`,
  `fields`); free-text (`reason`) is clamped to 64 characters.
- **`funnel_id` is session-scoped** and cleared when onboarding completes.
- The module **never throws** into wizard code and a broken sink cannot break
  onboarding.

Deployments remain responsible for their sink: send events over HTTPS, honour
Do-Not-Track / consent banners before calling `configure(fn)`, and set an
appropriate retention window on the analytics store (recommended ≤ 180 days for
raw funnel events).

---

## 3. Event catalogue

| Event | When | `props` |
|-------|------|---------|
| `onboarding_started` | Wizard loads at step 1 for a new session | — |
| `onboarding_step_viewed` | A step panel becomes visible | `step` (1–5), `stage` |
| `onboarding_step_completed` | User advances past a step | `step`, `stage` |
| `onboarding_step_back` | User navigates to an earlier step | `from_step`, `to_step` |
| `wallet_connect_attempted` | Freighter/Albedo connect clicked | `provider` (`freighter`\|`albedo`\|`demo`) |
| `wallet_connected` | Wallet address obtained (or demo selected) | `provider`, `is_demo` |
| `wallet_connect_failed` | Connect rejected or provider missing | `provider`, `reason` |
| `business_details_validation_failed` | Step 3 **Continue** with invalid fields | `fields` (subset of `name`,`description`,`email`,`category`) |
| `merchant_registration_submitted` | **Register Merchant** clicked | `is_demo` |
| `merchant_registration_succeeded` | Registration confirmed | `is_demo`, `duration_ms` |
| `merchant_registration_failed` | Registration threw / rejected | `is_demo`, `reason` |
| `onboarding_completed` | Step 5 reached | `duration_ms`, `is_demo` |
| `onboarding_abandoned` | Tab hidden/closed before step 5 (`pagehide`) | `step`, `stage` |

`reason` values currently emitted: `extension_not_found`,
`provider_unavailable`, `connection_rejected`, `submit_error`. Treat the set as
open — clamp and bucket unknown values downstream.

---

## 4. Metric definitions

All rates are computed over a chosen time window `W` (default: trailing 7 days),
keyed by `funnel_id`. "Sessions" = distinct `funnel_id` with an
`onboarding_started` event in `W`.

| Metric | Definition | Formula |
|--------|------------|---------|
| **Onboarding completion rate** | Share of started sessions that finish | `count(onboarding_completed) / count(onboarding_started)` |
| **Stage conversion rate** `s→s+1` | Progression between adjacent stages | `distinct funnel_id with step_viewed(s+1) / distinct funnel_id with step_viewed(s)` |
| **Stage drop-off rate** | Complement of stage conversion | `1 − stage_conversion(s→s+1)` |
| **Wallet connect success rate** | Connects that succeed | `count(wallet_connected) / count(wallet_connect_attempted)` |
| **Details validation failure rate** | Sessions hitting a step‑3 validation error | `distinct funnel_id with business_details_validation_failed / distinct funnel_id with step_viewed(3)` |
| **Registration success rate** | Submissions that confirm | `count(merchant_registration_succeeded) / count(merchant_registration_submitted)` |
| **Median time to complete** | Speed of the full funnel | `median(onboarding_completed.props.duration_ms)` |
| **Median registration latency** | Perceived confirmation wait | `median(merchant_registration_succeeded.props.duration_ms)` |
| **Abandonment rate by stage** | Where sessions are lost | `count(onboarding_abandoned by stage) / count(onboarding_started)` |
| **Demo share** | Fraction using demo wallet | `count(wallet_connected where is_demo) / count(wallet_connected)` |

### Funnel table (example layout)

| Stage | Entered | Converted to next | Conversion | Drop-off |
|-------|--------:|------------------:|-----------:|---------:|
| welcome | 1000 | 880 | 88.0% | 12.0% |
| wallet | 880 | 700 | 79.5% | 20.5% |
| business_details | 700 | 640 | 91.4% | 8.6% |
| review | 640 | 610 | 95.3% | 4.7% |
| done | 610 | — | — | — |

**Overall completion rate = 610 / 1000 = 61.0%.**

---

## 5. Targets & alert thresholds

These are starting points; tune against your own baseline once data exists.

| Metric | Target | Warning | Critical |
|--------|-------:|--------:|---------:|
| Onboarding completion rate | ≥ 60% | < 45% | < 30% |
| Wallet connect success rate | ≥ 85% | < 70% | < 50% |
| Registration success rate | ≥ 97% | < 90% | < 80% |
| Median time to complete | ≤ 4 min | > 8 min | > 15 min |
| Any single stage drop-off | ≤ 20% | > 35% | > 50% |

Alerts should fire only with a **minimum sample size** (e.g. ≥ 50 started
sessions in the window) to avoid paging on noise.

---

## 6. Wiring an analytics sink

```html
<!-- deployment-specific snippet, loaded after onboarding-analytics.js -->
<script>
  if (navigator.doNotTrack !== '1' && window.__lfConsentGranted) {
    OnboardingAnalytics.configure(function (event) {
      navigator.sendBeacon('/api/onboarding-metrics', JSON.stringify(event));
    });
  }
</script>
```

The sink receives already-validated, PII-free envelopes. If `configure` is
never called, or is called with a non-function, the wizard still emits — the
events are just discarded.

---

## 7. On-chain cross-check

`onboarding_completed` is a **client-side** signal (it fires on the demo path
too). For a ground-truth count of real merchants, reconcile against the
`lumenflow/merchant_registered` contract event
([events-reference.md](events-reference.md),
[monitoring.md](monitoring.md) → `lumenflow_merchants_registered_total`).

| Signal | Source | Meaning |
|--------|--------|---------|
| `onboarding_completed` (`is_demo=false`) | wizard | user finished the flow in live mode |
| `merchant_registered` | contract event | a merchant profile now exists on-chain |

A persistent gap (`onboarding_completed` ≫ `merchant_registered`) indicates
transactions are failing after submission — investigate wallet signing or RPC
submission.

---

## 8. Failure, permission & boundary behaviour

| Case | Behaviour |
|------|-----------|
| No sink configured | Module is a silent no-op; zero overhead beyond a cheap function call. |
| Sink throws | Caught and logged via `console.warn`; onboarding unaffected. |
| Unknown event name | Dropped; `OnboardingAnalytics.droppedCount()` incremented. |
| Invalid / out-of-range prop (`step` = 9, bad `provider`) | That prop is stripped; the event is still sent without it. |
| PII-shaped prop key (`email`, `wallet_address`, …) | Stripped before dispatch. |
| `sessionStorage` unavailable (private mode) | `funnel_id` falls back to an in-memory random id; no crash. |
| `crypto.randomUUID` unavailable | Falls back to a timestamp+random id. |
| Double `start()` | Second call is ignored; `onboarding_started` fires once per session. |
| Tab closed mid-funnel | `onboarding_abandoned` emitted on `pagehide` (best-effort — not guaranteed on hard kills). |

---

## 9. Automated coverage

Unit tests for the instrumentation module live at
[`frontend/tests/onboarding-analytics.test.js`](../frontend/tests/onboarding-analytics.test.js)
and cover the normal path (valid event reaches the sink with a well-formed
envelope) plus failure/boundary cases (unknown event dropped, PII stripped,
out-of-range props removed, throwing sink contained, no-op when unconfigured).

Run them with:

```bash
node --test frontend/tests/onboarding-analytics.test.js
```
