"""
LumenFlow Prometheus + OpenTelemetry Exporter
==============================================

Polls the Stellar Horizon API for LumenFlow contract events, exposes
Prometheus metrics, and emits OpenTelemetry (OTLP) trace spans so each
poll cycle can be correlated with specific RPC calls and ledger delays.

Environment Variables
---------------------
CONTRACT_ID         Soroban contract address to monitor (required)
HORIZON_URL         Horizon API base URL (default: https://horizon-testnet.stellar.org)
POLL_INTERVAL_SECS  Seconds between poll cycles (default: 10)
METRICS_PORT        Port for the Prometheus /metrics endpoint (default: 8000)
OTLP_ENDPOINT       OTLP gRPC endpoint for trace export
                    (default: http://localhost:4317)
OTEL_SERVICE_NAME   Service name reported in traces
                    (default: lumenflow-exporter)
CURSOR_FILE         Path used to persist the last-seen paging token
                    (default: /tmp/lumenflow_cursor.txt)
LOG_LEVEL           Python logging level (default: INFO)

Dependencies (pip install)
--------------------------
    prometheus_client>=0.20
    requests>=2.31
    opentelemetry-api>=1.24
    opentelemetry-sdk>=1.24
    opentelemetry-exporter-otlp-proto-grpc>=1.24

Usage
-----
    python lumenflow_exporter.py
"""

from __future__ import annotations

import logging
import os
import time
from pathlib import Path
from typing import Any

import requests
from prometheus_client import Counter, Gauge, Histogram, start_http_server

# ── OpenTelemetry imports ─────────────────────────────────────────────────────
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import SpanKind, StatusCode

# ── Configuration ─────────────────────────────────────────────────────────────

CONTRACT_ID: str = os.environ["CONTRACT_ID"]
HORIZON_URL: str = os.environ.get(
    "HORIZON_URL", "https://horizon-testnet.stellar.org"
).rstrip("/")
POLL_INTERVAL: int = int(os.environ.get("POLL_INTERVAL_SECS", "10"))
METRICS_PORT: int = int(os.environ.get("METRICS_PORT", "8000"))
OTLP_ENDPOINT: str = os.environ.get("OTLP_ENDPOINT", "http://localhost:4317")
SERVICE_NAME: str = os.environ.get("OTEL_SERVICE_NAME", "lumenflow-exporter")
CURSOR_FILE: Path = Path(os.environ.get("CURSOR_FILE", "/tmp/lumenflow_cursor.txt"))

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("lumenflow_exporter")

# ── Prometheus metrics ────────────────────────────────────────────────────────

EVENTS_TOTAL = Counter(
    "lumenflow_events_total",
    "Total number of contract events processed",
    ["event_name"],
)
POLL_DURATION = Histogram(
    "lumenflow_poll_duration_seconds",
    "Duration of each Horizon poll cycle in seconds",
    buckets=[0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
)
POLL_ERRORS = Counter(
    "lumenflow_poll_errors_total",
    "Total number of failed poll attempts",
)
LAST_LEDGER = Gauge(
    "lumenflow_last_ledger_sequence",
    "Ledger sequence of the most recently processed event",
)
PAYMENT_LATENCY = Histogram(
    "lumenflow_payment_processing_latency_seconds",
    "Time between ledger close and the exporter processing a payment_processed event",
    buckets=[1, 5, 10, 30, 60, 120, 300],
)

# ── OpenTelemetry setup ───────────────────────────────────────────────────────


def _setup_tracing() -> trace.Tracer:
    """Configure the OTLP trace exporter and return a tracer instance."""
    resource = Resource.create({"service.name": SERVICE_NAME})
    provider = TracerProvider(resource=resource)

    otlp_exporter = OTLPSpanExporter(endpoint=OTLP_ENDPOINT, insecure=True)
    provider.add_span_processor(BatchSpanProcessor(otlp_exporter))

    trace.set_tracer_provider(provider)
    log.info("OpenTelemetry tracing configured — OTLP endpoint: %s", OTLP_ENDPOINT)
    return trace.get_tracer(SERVICE_NAME)


# ── Cursor persistence ────────────────────────────────────────────────────────


def _load_cursor() -> str:
    """Return the persisted cursor token, or 'now' if none exists."""
    if CURSOR_FILE.exists():
        cursor = CURSOR_FILE.read_text().strip()
        if cursor:
            log.info("Resuming from cursor: %s", cursor)
            return cursor
    return "now"


def _save_cursor(cursor: str) -> None:
    CURSOR_FILE.write_text(cursor)


# ── Horizon polling ───────────────────────────────────────────────────────────


def _fetch_events(cursor: str) -> list[dict[str, Any]]:
    """
    Fetch up to 200 contract events from Horizon starting from *cursor*.

    Returns a list of event dicts ordered oldest-first.
    """
    url = (
        f"{HORIZON_URL}/contracts/{CONTRACT_ID}/events"
        f"?cursor={cursor}&order=asc&limit=200"
    )
    resp = requests.get(url, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    return data.get("_embedded", {}).get("records", [])


def _event_name(event: dict[str, Any]) -> str:
    topic: list[str] = event.get("topic", [])
    # LumenFlow topics: ["lumenflow", "<event_name>"]
    return topic[1] if len(topic) >= 2 else "unknown"


# ── Poll cycle ────────────────────────────────────────────────────────────────


def _run_poll_cycle(
    tracer: trace.Tracer,
    cursor: str,
) -> str:
    """
    Execute one poll cycle:
      1. Fetch new events from Horizon.
      2. Update Prometheus metrics.
      3. Emit an OpenTelemetry span with ledger + event metadata.

    Returns the updated cursor to use in the next cycle.
    """
    poll_start = time.time()

    with tracer.start_as_current_span(
        "lumenflow.poll_cycle",
        kind=SpanKind.CLIENT,
    ) as span:
        try:
            events = _fetch_events(cursor)
            poll_duration = time.time() - poll_start

            event_count = len(events)
            last_ledger: int = 0
            new_cursor = cursor

            for event in events:
                name = _event_name(event)
                EVENTS_TOTAL.labels(event_name=name).inc()

                ledger_seq: int = int(event.get("ledger", 0))
                if ledger_seq > last_ledger:
                    last_ledger = ledger_seq

                # Record payment processing latency for payment_processed events.
                if name == "payment_processed":
                    ledger_closed_at: str | None = event.get("ledger_closed_at")
                    if ledger_closed_at:
                        import datetime

                        closed_ts = datetime.datetime.fromisoformat(
                            ledger_closed_at.replace("Z", "+00:00")
                        ).timestamp()
                        latency = time.time() - closed_ts
                        if latency >= 0:
                            PAYMENT_LATENCY.observe(latency)
                            span.set_attribute(
                                "lumenflow.payment_latency_seconds", latency
                            )

                # Advance the cursor to avoid re-processing this event.
                paging_token: str = event.get("paging_token", "")
                if paging_token:
                    new_cursor = paging_token

            # Update Prometheus gauges.
            POLL_DURATION.observe(poll_duration)
            if last_ledger:
                LAST_LEDGER.set(last_ledger)

            # Annotate the trace span.
            span.set_attribute("lumenflow.ledger_sequence", last_ledger)
            span.set_attribute("lumenflow.event_count", event_count)
            span.set_attribute("lumenflow.poll_duration_seconds", poll_duration)
            span.set_attribute("lumenflow.cursor", new_cursor)
            span.set_status(StatusCode.OK)

            log.info(
                "Poll complete — events=%d ledger=%d duration=%.3fs cursor=%s",
                event_count,
                last_ledger,
                poll_duration,
                new_cursor,
            )

            if new_cursor != cursor:
                _save_cursor(new_cursor)

            return new_cursor

        except Exception as exc:  # noqa: BLE001
            POLL_ERRORS.inc()
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            log.error("Poll cycle failed: %s", exc)
            return cursor


# ── Entry point ───────────────────────────────────────────────────────────────


def main() -> None:
    log.info(
        "Starting LumenFlow exporter — contract=%s horizon=%s interval=%ds metrics_port=%d",
        CONTRACT_ID,
        HORIZON_URL,
        POLL_INTERVAL,
        METRICS_PORT,
    )

    tracer = _setup_tracing()
    start_http_server(METRICS_PORT)
    log.info("Prometheus metrics available at http://0.0.0.0:%d/metrics", METRICS_PORT)

    cursor = _load_cursor()

    while True:
        cursor = _run_poll_cycle(tracer, cursor)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
