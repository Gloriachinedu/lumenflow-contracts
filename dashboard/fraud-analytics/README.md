# Fraud Analytics Dashboard

A standalone HTML/JS dashboard that surfaces suspicious payment patterns from the
LumenFlow contract.

## Features

- **Recent `lumenflow/suspicious_activity` events** — table with merchant, reason,
  and amount for every event in the last 24 h.
- **Top merchants by refund rate** — ranked list highlighting merchants with
  unusually high refund-to-payment ratios.
- **Large payments (last 24 h)** — all payments that exceeded `large_payment_threshold`.
- **Velocity anomalies** — merchants whose recent payment frequency spikes well above
  their 7-day baseline.
- **Alert badge** on the nav bar when new suspicious events arrive since last visit.
- **Auto-refresh every 60 seconds** with manual Refresh button.
- **Mobile-responsive** layout using CSS Grid.
- **Dark mode** via `prefers-color-scheme: dark`.

## Data sources

| Mode | Condition | Source |
|------|-----------|--------|
| Live | `window.LUMENFLOW_CONTRACT_ID` set | Horizon SSE (`/accounts/<contract>/effects`) |
| Demo | No contract ID configured | Hard-coded demo data |

## Quick start

```bash
# Serve the dashboard locally
npx serve dashboard/fraud-analytics
# → http://localhost:3000
```

## Live mode configuration

Set these variables before serving (or inject via a build step into `index.html`):

```js
window.LUMENFLOW_CONTRACT_ID            = 'CABC…XYZ';
window.LUMENFLOW_HORIZON_URL            = 'https://horizon-testnet.stellar.org';
window.LUMENFLOW_LARGE_PAYMENT_THRESHOLD = 100_000; // in stroops
```
