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
