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
#!/usr/bin/env python3
"""
monitoring/lumenflow_exporter.py — Prometheus exporter for LumenFlow contract metrics.

Scrapes lumenflow/* events from the Stellar Horizon API and exposes them as
Prometheus metrics on :9101/metrics.

Usage:
    pip install prometheus_client requests
    CONTRACT_ID=<id> python3 monitoring/lumenflow_exporter.py

Environment variables:
    CONTRACT_ID       Required. Deployed LumenFlow contract address.
    HORIZON_URL       Default: https://horizon-testnet.stellar.org
    SCRAPE_INTERVAL   Seconds between Horizon polls. Default: 30
    EXPORTER_PORT     Port to expose /metrics on. Default: 9101
    CURSOR_FILE       Path to persist the last paging_token. Default: .lumenflow_cursor
    LUMENFLOW_VERSION Deployed release version, published via lumenflow_build_info. Default: unknown
    LUMENFLOW_COMMIT  Deployed commit SHA, published via lumenflow_build_info. Default: unknown
"""

import os
import sys
import time
import json
import logging
import requests
from prometheus_client import (
    start_http_server,
    Counter,
    Gauge,
    Histogram,
    CollectorRegistry,
    REGISTRY,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("lumenflow_exporter")

# ─── Configuration ─────────────────────────────────────────────────────────────
CONTRACT_ID     = os.environ.get("CONTRACT_ID", "")
HORIZON_URL     = os.environ.get("HORIZON_URL", "https://horizon-testnet.stellar.org")
SCRAPE_INTERVAL = int(os.environ.get("SCRAPE_INTERVAL", "30"))
EXPORTER_PORT   = int(os.environ.get("EXPORTER_PORT", "9101"))
CURSOR_FILE     = os.environ.get("CURSOR_FILE", ".lumenflow_cursor")

# Deployment identity, injected by the deploy pipeline so operators can tie a
# running instance back to an exact build. Defaults to "unknown" when unset.
BUILD_VERSION   = os.environ.get("LUMENFLOW_VERSION", "unknown")
BUILD_COMMIT    = os.environ.get("LUMENFLOW_COMMIT", "unknown")

if not CONTRACT_ID:
    log.error("CONTRACT_ID environment variable is required")
    sys.exit(1)

# ─── Prometheus metrics ────────────────────────────────────────────────────────
LABELS = ["contract_id"]

payments_total = Counter(
    "lumenflow_payments_total",
    "Total number of lumenflow/payment_processed events observed",
    LABELS,
)

refunds_initiated_total = Counter(
    "lumenflow_refunds_initiated_total",
    "Total number of lumenflow/refund_initiated events",
    LABELS,
)

refunds_executed_total = Counter(
    "lumenflow_refunds_total",
    "Total number of lumenflow/refund_executed events",
    LABELS,
)

errors_total = Counter(
    "lumenflow_errors_total",
    "Total number of lumenflow error-related events (suspicious_activity)",
    LABELS,
)

merchants_registered_total = Counter(
    "lumenflow_merchants_registered_total",
    "Total number of lumenflow/merchant_registered events",
    LABELS,
)

multisig_executed_total = Counter(
    "lumenflow_multisig_executed_total",
    "Total number of lumenflow/multisig_executed events",
    LABELS,
)

payment_amount = Histogram(
    "lumenflow_payment_amount",
    "Distribution of payment amounts in stroops",
    LABELS,
    buckets=[100, 1_000, 10_000, 100_000, 1_000_000, 10_000_000, 100_000_000],
)

active_merchants = Gauge(
    "lumenflow_active_merchants",
    "Approximate count of active (registered) merchants (increments only)",
    LABELS,
)

contract_paused = Gauge(
    "lumenflow_contract_paused",
    "1 if the contract is paused, 0 if active",
    LABELS,
)

scrape_errors_total = Counter(
    "lumenflow_scrape_errors_total",
    "Total number of Horizon scrape errors",
    LABELS,
)

last_scrape_timestamp = Gauge(
    "lumenflow_last_scrape_timestamp_seconds",
    "Unix timestamp of the last successful Horizon scrape",
    LABELS,
)

# Static "build_info" gauge (always set to 1) whose label set publishes the
# deployed version and commit SHA to runtime diagnostics — the standard
# Prometheus pattern for exposing build metadata.
build_info = Gauge(
    "lumenflow_build_info",
    "Deployment metadata for the running exporter/contract (always 1)",
    LABELS + ["version", "commit"],
)
build_info.labels(CONTRACT_ID, BUILD_VERSION, BUILD_COMMIT).set(1)

# ─── Cursor persistence ────────────────────────────────────────────────────────

def load_cursor() -> str:
    """Load the last-processed Horizon paging_token from disk."""
    if os.path.exists(CURSOR_FILE):
        with open(CURSOR_FILE) as f:
            return f.read().strip()
    return "now"


def save_cursor(token: str) -> None:
    """Persist the latest paging_token to disk."""
    with open(CURSOR_FILE, "w") as f:
        f.write(token)


# ─── Event processing ─────────────────────────────────────────────────────────

def process_event(event: dict) -> None:
    """Update Prometheus counters/gauges from a single Horizon event."""
    topic = event.get("topic", [])
    if len(topic) < 2:
        return

    event_name = topic[1]
    value      = event.get("value", {})
    lbl        = [CONTRACT_ID]

    if event_name == "payment_processed":
        payments_total.labels(*lbl).inc()
        amount = value.get("amount")
        if amount is not None:
            try:
                payment_amount.labels(*lbl).observe(int(amount))
            except (ValueError, TypeError):
                pass

    elif event_name == "refund_initiated":
        refunds_initiated_total.labels(*lbl).inc()

    elif event_name == "refund_executed":
        refunds_executed_total.labels(*lbl).inc()

    elif event_name == "merchant_registered":
        merchants_registered_total.labels(*lbl).inc()
        active_merchants.labels(*lbl).inc()

    elif event_name == "merchant_deactivated":
        active_merchants.labels(*lbl).dec()

    elif event_name == "suspicious_activity":
        errors_total.labels(*lbl).inc()

    elif event_name == "multisig_executed":
        multisig_executed_total.labels(*lbl).inc()

    # Detect pause / unpause
    elif event_name == "contract_paused":
        contract_paused.labels(*lbl).set(1)
    elif event_name == "contract_unpaused":
        contract_paused.labels(*lbl).set(0)


# ─── Scrape loop ───────────────────────────────────────────────────────────────

def scrape_once(cursor: str) -> str:
    """
    Fetch one page of new events from Horizon and process them.
    Returns the updated cursor (paging_token of the last event seen).
    """
    url = (
        f"{HORIZON_URL}/contracts/{CONTRACT_ID}/events"
        f"?cursor={cursor}&limit=200&order=asc"
    )

    try:
        resp = requests.get(url, timeout=15)
        resp.raise_for_status()
    except Exception as exc:
        log.warning("Horizon request failed: %s", exc)
        scrape_errors_total.labels(CONTRACT_ID).inc()
        return cursor

    data    = resp.json()
    records = data.get("_embedded", {}).get("records", [])

    for event in records:
        process_event(event)
        paging_token = event.get("paging_token")
        if paging_token:
            cursor = paging_token

    last_scrape_timestamp.labels(CONTRACT_ID).set(time.time())
    log.info("Scraped %d events; cursor=%s", len(records), cursor)
    return cursor


def main() -> None:
    log.info("Starting LumenFlow Prometheus exporter")
    log.info("Contract : %s", CONTRACT_ID)
    log.info("Build    : %s (%s)", BUILD_VERSION, BUILD_COMMIT)
    log.info("Horizon  : %s", HORIZON_URL)
    log.info("Port     : %d", EXPORTER_PORT)
    log.info("Interval : %ds", SCRAPE_INTERVAL)

    start_http_server(EXPORTER_PORT)
    log.info("Metrics endpoint: http://0.0.0.0:%d/metrics", EXPORTER_PORT)

    cursor = load_cursor()

    while True:
        cursor = scrape_once(cursor)
        save_cursor(cursor)
        time.sleep(SCRAPE_INTERVAL)


if __name__ == "__main__":
    main()
