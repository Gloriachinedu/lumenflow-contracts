# LumenFlow Observability Guide

This guide covers the LumenFlow monitoring exporter (`monitoring/lumenflow_exporter.py`), which combines **Prometheus metrics** and **OpenTelemetry distributed traces** to give full visibility into payment event processing.

---

## Architecture Overview

```
  Stellar Horizon API
        │  (HTTP poll)
        ▼
 lumenflow_exporter.py
   ├── Prometheus /metrics  ─────────────────► Prometheus → Grafana dashboards
   └── OTLP gRPC traces  ───────────────────► Grafana Tempo (or Jaeger / Zipkin)
```

The exporter runs as a long-lived process, polling Horizon for new contract events, recording Prometheus counters/histograms, and emitting an OpenTelemetry trace span for every poll cycle.

---

## Installation

```bash
cd monitoring/
pip install -r requirements.txt
```

Dependencies (pinned in `requirements.txt`):

| Package | Purpose |
|---------|---------|
| `prometheus_client` | Exposes `/metrics` endpoint |
| `requests` | HTTP client for Horizon API |
| `opentelemetry-api` | OTel instrumentation API |
| `opentelemetry-sdk` | OTel SDK + tracer provider |
| `opentelemetry-exporter-otlp-proto-grpc` | OTLP gRPC trace exporter |

---

## Configuration

All configuration is done via environment variables.

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CONTRACT_ID` | **Yes** | — | Soroban contract address to monitor |
| `HORIZON_URL` | No | `https://horizon-testnet.stellar.org` | Horizon API base URL |
| `POLL_INTERVAL_SECS` | No | `10` | Seconds between poll cycles |
| `METRICS_PORT` | No | `8000` | Port for the Prometheus `/metrics` endpoint |
| `OTLP_ENDPOINT` | No | `http://localhost:4317` | OTLP gRPC endpoint for trace export |
| `OTEL_SERVICE_NAME` | No | `lumenflow-exporter` | Service name reported in traces |
| `CURSOR_FILE` | No | `/tmp/lumenflow_cursor.txt` | Path to persist the last-seen paging token |
| `LOG_LEVEL` | No | `INFO` | Python logging level |

### Example

```bash
export CONTRACT_ID="CABC...XYZ"
export HORIZON_URL="https://horizon.stellar.org"
export OTLP_ENDPOINT="http://tempo:4317"
export POLL_INTERVAL_SECS="15"
export METRICS_PORT="9090"

python monitoring/lumenflow_exporter.py
```

---

## Running with Docker Compose

Add the exporter to your `docker-compose.yml` alongside Grafana Tempo:

```yaml
services:
  lumenflow-exporter:
    image: python:3.12-slim
    working_dir: /app
    volumes:
      - ./monitoring:/app
    command: >
      sh -c "pip install -r requirements.txt -q && python lumenflow_exporter.py"
    environment:
      CONTRACT_ID: "${CONTRACT_ID}"
      HORIZON_URL: "${HORIZON_URL:-https://horizon-testnet.stellar.org}"
      OTLP_ENDPOINT: "http://tempo:4317"
      METRICS_PORT: "8000"
    ports:
      - "8000:8000"
    restart: unless-stopped

  tempo:
    image: grafana/tempo:latest
    command: ["-config.file=/etc/tempo.yaml"]
    ports:
      - "4317:4317"   # OTLP gRPC
      - "3200:3200"   # Tempo query API
```

---

## Prometheus Metrics

Prometheus scrapes the `/metrics` endpoint exposed at `METRICS_PORT`.

| Metric | Type | Labels | Description |
|--------|------|--------|-------------|
| `lumenflow_events_total` | Counter | `event_name` | Total contract events processed |
| `lumenflow_poll_duration_seconds` | Histogram | — | Duration of each Horizon poll cycle |
| `lumenflow_poll_errors_total` | Counter | — | Failed poll attempts |
| `lumenflow_last_ledger_sequence` | Gauge | — | Ledger sequence of the most recently processed event |
| `lumenflow_payment_processing_latency_seconds` | Histogram | — | Time between ledger close and exporter processing a `payment_processed` event |

### Example Prometheus scrape config

```yaml
# prometheus.yml
scrape_configs:
  - job_name: lumenflow
    static_configs:
      - targets: ['lumenflow-exporter:8000']
```

---

## OpenTelemetry Traces

Every poll cycle emits a trace span named **`lumenflow.poll_cycle`** with the following attributes:

| Attribute | Type | Description |
|-----------|------|-------------|
| `lumenflow.ledger_sequence` | int | Ledger sequence of the last processed event in this cycle |
| `lumenflow.event_count` | int | Number of events fetched in this cycle |
| `lumenflow.poll_duration_seconds` | float | Wall-clock time for the Horizon HTTP request + processing |
| `lumenflow.cursor` | string | Updated cursor token after processing |
| `lumenflow.payment_latency_seconds` | float | (payment_processed events only) time since ledger close |

Errors are recorded on the span with `span.record_exception()` and the span status is set to `ERROR`.

### Viewing traces in Grafana Tempo

1. Open Grafana and add a **Tempo** data source pointing to `http://tempo:3200`.
2. Navigate to **Explore → Tempo**.
3. Search by service name `lumenflow-exporter` or filter by the `lumenflow.ledger_sequence` attribute.

To correlate traces with Prometheus metrics, use Grafana's **TraceQL** and **Exemplars** features:

```
{ .service.name = "lumenflow-exporter" && .lumenflow.event_count > 0 }
```

---

## Cursor Persistence

The exporter persists the last-seen Horizon `paging_token` to `CURSOR_FILE` after each successful poll. On restart, it resumes from that token to avoid gaps or duplicate processing.

If the cursor file is lost, the exporter falls back to `cursor=now` and will only process events received after the restart.

---

## Further Reading

- [LumenFlow Monitoring Guide](monitoring.md)
- [LumenFlow Events Reference](events-reference.md)
- [Stellar Horizon Events API](https://developers.stellar.org/docs/data/horizon/api-reference/resources/events)
- [OpenTelemetry Python SDK](https://opentelemetry-python.readthedocs.io/)
- [Grafana Tempo](https://grafana.com/docs/tempo/latest/)
