"""
lumenflow_exporter.py
=====================
Polls the Stellar Horizon SSE event stream for LumenFlow contract events,
exposes Prometheus metrics, and (optionally) emits OpenTelemetry distributed
traces.

Environment variables
---------------------
CONTRACT_ID                  Required.  Soroban contract address.
HORIZON_URL                  Optional.  Horizon base URL.
                                        Default: https://horizon-testnet.stellar.org
POLL_INTERVAL_SECONDS        Optional.  Seconds between full re-polls (non-SSE fallback).
                                        Default: 15
METRICS_PORT                 Optional.  Port for the Prometheus /metrics endpoint.
                                        Default: 8000

OpenTelemetry (all optional — tracing is disabled when OTEL_EXPORTER_OTLP_ENDPOINT is unset)
OTEL_EXPORTER_OTLP_ENDPOINT  OTLP gRPC/HTTP endpoint, e.g. http://localhost:4317
OTEL_SERVICE_NAME            Service name reported in traces.
                                        Default: lumenflow-exporter
OTEL_RESOURCE_ATTRIBUTES     Extra resource attributes (KEY=VALUE,KEY=VALUE …)

Usage
-----
    pip install -r monitoring/requirements.txt
    CONTRACT_ID=C... python monitoring/lumenflow_exporter.py

    # With OpenTelemetry (e.g. local Jaeger all-in-one)
    OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317 \\
    CONTRACT_ID=C... python monitoring/lumenflow_exporter.py
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time
from typing import Any, Dict, Optional

import requests
from prometheus_client import Counter, Histogram, start_http_server

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("lumenflow_exporter")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
CONTRACT_ID: str = os.environ["CONTRACT_ID"]
HORIZON_URL: str = os.environ.get(
    "HORIZON_URL", "https://horizon-testnet.stellar.org"
)
POLL_INTERVAL: int = int(os.environ.get("POLL_INTERVAL_SECONDS", "15"))
METRICS_PORT: int = int(os.environ.get("METRICS_PORT", "8000"))
OTEL_ENDPOINT: Optional[str] = os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT") or None
SERVICE_NAME: str = os.environ.get("OTEL_SERVICE_NAME", "lumenflow-exporter")

# ---------------------------------------------------------------------------
# Prometheus metrics
# ---------------------------------------------------------------------------
EVENTS_TOTAL = Counter(
    "lumenflow_events_total",
    "Total number of LumenFlow contract events ingested",
    ["event_name"],
)
INGESTION_DURATION = Histogram(
    "lumenflow_ingestion_duration_seconds",
    "Time spent processing a single event ingestion cycle",
)
INGESTION_ERRORS = Counter(
    "lumenflow_ingestion_errors_total",
    "Total errors encountered during event ingestion",
)

# ---------------------------------------------------------------------------
# OpenTelemetry setup (optional)
# ---------------------------------------------------------------------------
_tracer = None  # type: ignore[assignment]


def _setup_otel() -> None:
    """Initialise OpenTelemetry tracing if OTEL_EXPORTER_OTLP_ENDPOINT is set.

    All OpenTelemetry imports are deferred inside this function so that the
    exporter works without the opentelemetry packages when tracing is disabled.
    """
    global _tracer  # noqa: PLW0603

    if OTEL_ENDPOINT is None:
        log.info("OTEL_EXPORTER_OTLP_ENDPOINT not set — OpenTelemetry tracing disabled.")
        return

    try:
        from opentelemetry import trace
        from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import (
            OTLPSpanExporter,
        )
        from opentelemetry.sdk.resources import SERVICE_NAME as OTEL_SVC_NAME
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError as exc:
        log.error(
            "opentelemetry-sdk packages not installed. "
            "Run: pip install opentelemetry-sdk opentelemetry-exporter-otlp-proto-grpc\n"
            "Error: %s",
            exc,
        )
        return

    resource = Resource.create({OTEL_SVC_NAME: SERVICE_NAME})
    provider = TracerProvider(resource=resource)
    exporter = OTLPSpanExporter(endpoint=OTEL_ENDPOINT, insecure=True)
    provider.add_span_processor(BatchSpanProcessor(exporter))
    trace.set_tracer_provider(provider)
    _tracer = trace.get_tracer(__name__)
    log.info(
        "OpenTelemetry tracing enabled → endpoint=%s  service=%s",
        OTEL_ENDPOINT,
        SERVICE_NAME,
    )


def _start_span(name: str, attributes: Optional[Dict[str, Any]] = None):
    """Context manager that wraps a named OTel span, or is a no-op if disabled."""
    if _tracer is None:
        from contextlib import nullcontext  # Python 3.7+

        return nullcontext()

    from opentelemetry.trace import SpanKind

    span = _tracer.start_span(name, kind=SpanKind.INTERNAL)
    if attributes:
        for k, v in attributes.items():
            span.set_attribute(k, str(v))

    from opentelemetry import context as otel_context
    from opentelemetry.trace import use_span

    return use_span(span, end_on_exit=True)


# ---------------------------------------------------------------------------
# Event ingestion
# ---------------------------------------------------------------------------

KNOWN_EVENTS = {
    "payment_processed",
    "refund_initiated",
    "refund_approved",
    "refund_rejected",
    "refund_executed",
    "multisig_initiated",
    "multisig_executed",
    "merchant_registered",
    "admin_set",
    "payment_archived",
    "payment_request_paid",
    "suspicious_activity",
}


def _fetch_events(cursor: Optional[str] = None) -> list[Dict[str, Any]]:
    """Fetch recent contract events from Horizon REST API.

    Returns a list of raw event dicts (may be empty).
    """
    params: Dict[str, Any] = {"order": "asc", "limit": 200}
    if cursor:
        params["cursor"] = cursor

    url = f"{HORIZON_URL}/contracts/{CONTRACT_ID}/events"
    resp = requests.get(url, params=params, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    return data.get("_embedded", {}).get("records", [])


def _process_event(raw: Dict[str, Any]) -> None:
    """Record Prometheus metrics (and an OTel span) for a single event."""
    topic: list = raw.get("topic", [])
    event_name: str = topic[1] if len(topic) >= 2 else "unknown"

    attributes = {
        "event.name": event_name,
        "event.ledger": str(raw.get("ledger", "")),
        "contract.id": CONTRACT_ID,
        "event.id": str(raw.get("id", "")),
    }

    with _start_span(f"lumenflow.ingest.{event_name}", attributes=attributes):
        EVENTS_TOTAL.labels(event_name=event_name).inc()
        log.info("Ingested event: %s  ledger=%s", event_name, raw.get("ledger"))


def run_ingestion_cycle(cursor: Optional[str]) -> Optional[str]:
    """Run one full ingestion cycle.

    Fetches events since *cursor*, processes each one, and returns the
    updated cursor (paging_token of the last processed event).
    """
    with _start_span(
        "lumenflow.ingestion_cycle",
        attributes={"contract.id": CONTRACT_ID, "cursor": cursor or "initial"},
    ):
        with INGESTION_DURATION.time():
            try:
                events = _fetch_events(cursor)
                for event in events:
                    _process_event(event)
                    cursor = event.get("paging_token", cursor)
                return cursor
            except requests.HTTPError as exc:
                log.error("HTTP error fetching events: %s", exc)
                INGESTION_ERRORS.inc()
            except requests.RequestException as exc:
                log.error("Network error fetching events: %s", exc)
                INGESTION_ERRORS.inc()
            except Exception as exc:  # noqa: BLE001
                log.exception("Unexpected error during ingestion: %s", exc)
                INGESTION_ERRORS.inc()
    return cursor


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    _setup_otel()

    log.info(
        "Starting LumenFlow exporter  contract=%s  horizon=%s  metrics_port=%d",
        CONTRACT_ID,
        HORIZON_URL,
        METRICS_PORT,
    )
    start_http_server(METRICS_PORT)
    log.info("Prometheus metrics available on http://0.0.0.0:%d/metrics", METRICS_PORT)

    cursor: Optional[str] = None

    while True:
        cursor = run_ingestion_cycle(cursor)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        log.info("Shutting down.")
        sys.exit(0)
