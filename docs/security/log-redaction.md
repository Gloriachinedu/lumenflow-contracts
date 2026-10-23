# Removing sensitive values from logs

**Issue:** [#892](https://github.com/Gloriachinedu/lumenflow-contracts/issues/892)
**Scope:** application logs (SDK, webhook relay, dashboard API) and deployment
/ CI logs.

Logs are shipped to third-party aggregators and retained far longer than the
data they describe. A secret in a log line is a secret disclosed. This
document states the rule and the tooling that enforces it.

## Rule

Never log a raw credential. That includes:

- Stellar secret seeds (`S…`), PEM private keys, BIP-39 mnemonics
- `Authorization` header values, cookies, session IDs
- API keys, access / refresh tokens, webhook signing secrets
- full request bodies or upstream responses that may embed the above

## Application logs — `@lumenflow/sdk`

Use the helpers in `sdk/src/security/logRedaction.ts` at every point that
emits text you do not fully control:

```ts
import { redactSecrets, redactingLogger } from "@lumenflow/sdk";

const log = redactingLogger(console.error);
log("payment failed", { orderId, headers });   // secrets scrubbed

try {
  await submit(tx);
} catch (err) {
  log("submit failed", redactSecrets(err));     // secret-in-message scrubbed
}
```

`redactSecrets` replaces values under known secret keys wholesale and scrubs
credential-shaped substrings from any string; `redactString` covers plain
strings. Both leave the field name / scheme in place so lines stay useful.

Automated coverage: `sdk/src/tests/security/logRedaction.test.ts` exercises the
normal path plus edge cases (circular references, `Error` objects, non-secret
text left untouched).

## Deployment and CI logs

- CI never `echo`s a secret. GitHub Actions masks values that come from
  `secrets.*`; do not copy them into other variables or command output.
- `gitleaks` runs in `secrets-scan.yml` with `--redact`, and the pre-commit
  hook (`.githooks/pre-commit`) runs `gitleaks protect --staged --redact`, so
  detected values are shown as rule IDs, never plaintext.
- Deployment scripts under `scripts/` read secrets from the environment and
  must not print them; pass `set +x` around any block that references one.

## Monitoring exporter — `monitoring/lumenflow_exporter.py`

**Issue:** [#1261](https://github.com/Gloriachinedu/lumenflow-contracts/issues/1261)

The Prometheus exporter polls raw contract event payloads from Horizon. These
payloads can contain `contact_info`, payer addresses, and exact payment amounts.
All three are redacted before any log statement using the helpers in
`monitoring/redact.py`.

### Redaction rules for event payloads

| Field type | Rule | Example output |
|---|---|---|
| `contact_info` (and aliases) | Value replaced with `[REDACTED]` | `"[REDACTED]"` |
| Payer / address fields | Truncated to first 8 + last 4 chars | `"GAAZI4TC…CCWN"` |
| Amount fields | Replaced with range-bucket label | `"1M–10M"` |
| Stellar address embedded in a string | In-place truncation via regex | `"paid by GAAZI4TC…CCWN"` |

### Redacted field names

**Contact info keys** (value always hidden): `contact_info`, `contactinfo`,
`contact`, `email`, `phone`, `mobile`

**Address keys** (value truncated): `payer`, `payer_address`, `initiator`,
`merchant`, `merchant_address`, `address`, `from`, `to`

**Amount keys** (value bucketed): `amount`, `refund_amount`, `total`, `value`,
`fee`, `platform_fee`

### Amount range buckets

| Range (stroops) | Label |
|---|---|
| 0 – 999 | `<1K` |
| 1 000 – 9 999 | `1K–10K` |
| 10 000 – 99 999 | `10K–100K` |
| 100 000 – 999 999 | `100K–1M` |
| 1 000 000 – 9 999 999 | `1M–10M` |
| 10 000 000 – 99 999 999 | `10M–100M` |
| ≥ 100 000 000 | `≥100M` |

### Usage in the exporter

```python
from redact import redact_event

safe = redact_event(raw_event_dict)
log.info("Ingested event: %s  ledger=%s", event_name, safe.get("ledger"))
```

`redact_event` returns a **deep copy** — the original dict is never mutated.

### Tests

Unit tests are in `monitoring/test_redact.py` and cover all three redaction
rules plus immutability and edge cases:

```bash
cd monitoring && python -m pytest test_redact.py -v
```

## Reviewing a change

When reviewing code that adds logging, check that no credential, header, cookie,
or full request/response object is logged without passing through
`redactSecrets` (SDK) or `redact_event` (monitoring exporter).
