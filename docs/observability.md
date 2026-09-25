# LumenFlow Observability — OpenTelemetry Trace Export

This document covers the distributed tracing support added to
`monitoring/lumenflow_exporter.py`. For Prometheus metrics and Horizon event
streaming details, see [docs/monitoring.md](monitoring.md).

---

## Overview

`lumenflow_exporter.py` exports two complementary observability signals:

| Signal | Backend | Always active? |
|---|---|---|
| Prometheus metrics | `/metrics` HTTP endpoint | Yes |
| OpenTelemetry traces | Any OTLP-compatible backend | Only when `OTEL_EXPORTER_OTLP_ENDPOINT` is set |

Tracing is **opt-in**: if `OTEL_EXPORTER_OTLP_ENDPOINT` is not set, the
exporter starts normally with no tracing overhead and no dependency on the
OpenTelemetry packages at runtime (they are still listed in
`requirements.txt` for convenience).

---

## Spans emitted

Each ingestion cycle creates a parent span plus one child span per event:

```
lumenflow.ingestion_cycle   (parent — one per poll interval)
  └─ lumenflow.ingest.<event_name>   (child — one per contract event)
```

### `lumenflow.ingestion_cycle`

| Attribute | Description |
|---|---|
| `contract.id` | Soroban contract address |
| `cursor` | Horizon paging token at start of cycle (`"initial"` on first run) |

### `lumenflow.ingest.<event_name>`

`<event_name>` is the second element of the Horizon event `topic` array,
e.g. `lumenflow.ingest.payment_processed`.

| Attribute | Description |
|---|---|
| `event.name` | Event name (e.g. `payment_processed`) |
| `event.ledger` | Stellar ledger sequence number |
| `contract.id` | Soroban contract address |
| `event.id` | Horizon event ID |

---

## Setup

### 1. Install dependencies

```bash
pip install -r monitoring/requirements.txt
```

### 2. Configure environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `CONTRACT_ID` | **Yes** | — | Soroban contract address |
| `HORIZON_URL` | No | `https://horizon-testnet.stellar.org` | Horizon base URL |
| `POLL_INTERVAL_SECONDS` | No | `15` | Seconds between ingestion cycles |
| `METRICS_PORT` | No | `8000` | Prometheus metrics port |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | No | *(tracing disabled)* | OTLP endpoint for traces |
| `OTEL_SERVICE_NAME` | No | `lumenflow-exporter` | Service name in traces |
| `OTEL_RESOURCE_ATTRIBUTES` | No | — | Extra `KEY=VALUE,…` resource attributes |

### 3. Run the exporter

**Without tracing** (Prometheus metrics only):

```bash
CONTRACT_ID=<your-contract-id> python monitoring/lumenflow_exporter.py
```

**With tracing** (Jaeger all-in-one on localhost):

```bash
# Start Jaeger
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4317:4317 \
  jaegertracing/all-in-one:1.60

# Run exporter
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
CONTRACT_ID=<your-contract-id> \
python monitoring/lumenflow_exporter.py
```

Open [http://localhost:16686](http://localhost:16686) to view traces in Jaeger.

**With AWS X-Ray** (via the AWS Distro for OpenTelemetry Collector):

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \
OTEL_SERVICE_NAME=lumenflow-exporter \
CONTRACT_ID=<your-contract-id> \
python monitoring/lumenflow_exporter.py
```

Configure the ADOT Collector to forward spans to X-Ray using an
`awsxray` exporter pipeline. Refer to the
[AWS ADOT documentation](https://aws-otel.github.io/docs/getting-started/python-sdk/trace-manual-instr)
for details.

---

## Disabling tracing

Simply unset (or do not set) `OTEL_EXPORTER_OTLP_ENDPOINT`. The exporter
will log:

```
OTEL_EXPORTER_OTLP_ENDPOINT not set — OpenTelemetry tracing disabled.
```

and continue running with Prometheus metrics only.

---

## Prometheus metrics reference

| Metric | Type | Labels | Description |
|---|---|---|---|
| `lumenflow_events_total` | Counter | `event_name` | Total events ingested |
| `lumenflow_ingestion_duration_seconds` | Histogram | — | Duration of each ingestion cycle |
| `lumenflow_ingestion_errors_total` | Counter | — | Total ingestion errors |

---

## Further reading

- [OpenTelemetry Python SDK](https://opentelemetry.io/docs/instrumentation/python/)
- [OTLP Exporter (gRPC)](https://opentelemetry-python.readthedocs.io/en/latest/exporter/otlp/otlp.html)
- [Jaeger Getting Started](https://www.jaegertracing.io/docs/getting-started/)
- [LumenFlow Monitoring Guide](monitoring.md)
- [LumenFlow Events Reference](events-reference.md)
