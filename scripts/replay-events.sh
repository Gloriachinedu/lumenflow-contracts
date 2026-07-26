#!/usr/bin/env bash
# scripts/replay-events.sh — Reconstruct LumenFlow payment/refund history from Horizon.
#
# Fetches all lumenflow/* contract events from Horizon, reconstructs payment and
# refund records, validates replay state, and writes a CSV of all replayed records.
#
# Usage:
#   CONTRACT_ID=<id> ./scripts/replay-events.sh [OPTIONS]
#
# Options (environment variables):
#   CONTRACT_ID       Required. Deployed LumenFlow contract ID.
#   HORIZON_URL       Horizon endpoint. Default: https://horizon-testnet.stellar.org
#   OUTPUT_CSV        CSV output file path. Default: replay-output-<timestamp>.csv
#   DB_FILE           SQLite database file. Default: replay-db-<timestamp>.sqlite
#   DATE_FROM         ISO-8601 date lower bound, e.g. 2024-01-01 (optional)
#   DATE_TO           ISO-8601 date upper bound, e.g. 2024-12-31 (optional)
#   MERCHANT_FILTER   Filter to a specific merchant address (optional)
#   PAGE_LIMIT        Events per Horizon page. Default: 200
#   VALIDATE          Set to 1 to compare replayed state against on-chain stats.
#                     Requires stellar CLI to be installed. Default: 0
#   NETWORK           Stellar network for validation. Default: testnet
#
# Dependencies:
#   - curl
#   - jq (>= 1.6)
#   - sqlite3
#   - python3 (for CSV generation)
#   - stellar (optional, required for --validate)
#
# Exit codes:
#   0  Success
#   1  Missing required dependency or environment variable
#   2  Horizon fetch error
#   3  Validation mismatch

set -euo pipefail

# ─── Colour helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ─── Configuration ────────────────────────────────────────────────────────────
: "${CONTRACT_ID:?CONTRACT_ID is required}"

HORIZON_URL="${HORIZON_URL:-https://horizon-testnet.stellar.org}"
TIMESTAMP=$(date -u +%Y%m%d_%H%M%S)
OUTPUT_CSV="${OUTPUT_CSV:-replay-output-${TIMESTAMP}.csv}"
DB_FILE="${DB_FILE:-replay-db-${TIMESTAMP}.sqlite}"
DATE_FROM="${DATE_FROM:-}"
DATE_TO="${DATE_TO:-}"
MERCHANT_FILTER="${MERCHANT_FILTER:-}"
PAGE_LIMIT="${PAGE_LIMIT:-200}"
VALIDATE="${VALIDATE:-0}"
NETWORK="${NETWORK:-testnet}"

# ─── Dependency checks ────────────────────────────────────────────────────────
for cmd in curl jq sqlite3 python3; do
  if ! command -v "$cmd" &>/dev/null; then
    error "Required command not found: $cmd"
    exit 1
  fi
done

if [ "$VALIDATE" = "1" ] && ! command -v stellar &>/dev/null; then
  error "stellar CLI is required when VALIDATE=1"
  exit 1
fi

info "Starting event replay for contract: $CONTRACT_ID"
info "Horizon endpoint: $HORIZON_URL"
info "Database: $DB_FILE"
info "Output CSV: $OUTPUT_CSV"
[ -n "$DATE_FROM" ]         && info "Date filter from: $DATE_FROM"
[ -n "$DATE_TO" ]           && info "Date filter to:   $DATE_TO"
[ -n "$MERCHANT_FILTER" ]   && info "Merchant filter:  $MERCHANT_FILTER"

# ─── Initialise SQLite database ───────────────────────────────────────────────
info "Initialising local database..."

sqlite3 "$DB_FILE" <<'SQL'
CREATE TABLE IF NOT EXISTS events (
    id               TEXT PRIMARY KEY,
    paging_token     TEXT NOT NULL,
    ledger           INTEGER NOT NULL,
    ledger_closed_at TEXT NOT NULL,
    event_type       TEXT NOT NULL,
    raw_value        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
    order_id         TEXT PRIMARY KEY,
    payer            TEXT NOT NULL,
    merchant         TEXT NOT NULL,
    token            TEXT NOT NULL,
    amount           INTEGER NOT NULL,
    memo             TEXT,
    status           TEXT NOT NULL DEFAULT 'Completed',
    ledger           INTEGER NOT NULL,
    timestamp        TEXT NOT NULL,
    refunded_total   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS refunds (
    refund_id        TEXT PRIMARY KEY,
    order_id         TEXT NOT NULL,
    amount           INTEGER NOT NULL,
    reason           TEXT,
    status           TEXT NOT NULL,
    initiated_at     TEXT NOT NULL,
    resolved_at      TEXT
);

CREATE TABLE IF NOT EXISTS replay_meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
SQL

success "Database initialised."

# ─── Fetch events from Horizon ────────────────────────────────────────────────
info "Fetching lumenflow/* events from Horizon..."

CURSOR="0"
TOTAL_FETCHED=0
PAGE=0

while true; do
  PAGE=$((PAGE + 1))
  URL="${HORIZON_URL}/contracts/${CONTRACT_ID}/events?cursor=${CURSOR}&limit=${PAGE_LIMIT}&order=asc"

  RESPONSE=$(curl -sf "$URL" 2>/dev/null) || {
    error "Failed to fetch events from Horizon: $URL"
    exit 2
  }

  # Extract records
  RECORDS=$(echo "$RESPONSE" | jq -c '._embedded.records // []')
  COUNT=$(echo "$RECORDS" | jq 'length')

  if [ "$COUNT" -eq 0 ]; then
    info "No more events. Total pages: $PAGE, total events: $TOTAL_FETCHED"
    break
  fi

  TOTAL_FETCHED=$((TOTAL_FETCHED + COUNT))
  info "Page $PAGE: fetched $COUNT events (total: $TOTAL_FETCHED)"

  # Persist raw events to SQLite
  echo "$RECORDS" | jq -c '.[]' | while IFS= read -r event; do
    EV_ID=$(echo "$event"        | jq -r '.id')
    EV_PAGING=$(echo "$event"    | jq -r '.paging_token')
    EV_LEDGER=$(echo "$event"    | jq -r '.ledger')
    EV_CLOSED=$(echo "$event"    | jq -r '.ledger_closed_at')
    EV_TYPE=$(echo "$event"      | jq -r '.topic[1] // .topic[0] // "unknown"')
    EV_RAW=$(echo "$event"       | jq -c '.')

    sqlite3 "$DB_FILE" \
      "INSERT OR IGNORE INTO events
         (id, paging_token, ledger, ledger_closed_at, event_type, raw_value)
       VALUES
         ('${EV_ID//\'/\'\'}', '${EV_PAGING//\'/\'\'}',
          ${EV_LEDGER}, '${EV_CLOSED//\'/\'\'}',
          '${EV_TYPE//\'/\'\'}', '${EV_RAW//\'/\'\'}'
         );"
  done

  # Advance cursor
  CURSOR=$(echo "$RECORDS" | jq -r '.[-1].paging_token')
done

success "All events fetched and stored."

# ─── Reconstruct payments and refunds ─────────────────────────────────────────
info "Reconstructing payment and refund records from events..."

sqlite3 "$DB_FILE" <<'SQL'
-- Process payment_processed events
INSERT OR REPLACE INTO payments
    (order_id, payer, merchant, token, amount, memo, status, ledger, timestamp)
SELECT
    json_extract(e.raw_value, '$.value.order_id')  AS order_id,
    json_extract(e.raw_value, '$.value.payer')     AS payer,
    json_extract(e.raw_value, '$.value.merchant')  AS merchant,
    json_extract(e.raw_value, '$.value.token')     AS token,
    CAST(json_extract(e.raw_value, '$.value.amount') AS INTEGER) AS amount,
    json_extract(e.raw_value, '$.value.memo')      AS memo,
    'Completed'                                     AS status,
    e.ledger,
    e.ledger_closed_at                              AS timestamp
FROM events e
WHERE e.event_type = 'payment_processed'
  AND json_extract(e.raw_value, '$.value.order_id') IS NOT NULL;

-- Process refund_initiated events
INSERT OR REPLACE INTO refunds
    (refund_id, order_id, amount, reason, status, initiated_at)
SELECT
    json_extract(e.raw_value, '$.value.refund_id') AS refund_id,
    json_extract(e.raw_value, '$.value.order_id')  AS order_id,
    CAST(json_extract(e.raw_value, '$.value.amount') AS INTEGER) AS amount,
    json_extract(e.raw_value, '$.value.reason')    AS reason,
    'Pending',
    e.ledger_closed_at
FROM events e
WHERE e.event_type = 'refund_initiated'
  AND json_extract(e.raw_value, '$.value.refund_id') IS NOT NULL;

-- Flip refunds to Approved
UPDATE refunds
SET status = 'Approved',
    resolved_at = (
        SELECT e.ledger_closed_at FROM events e
        WHERE e.event_type = 'refund_approved'
          AND json_extract(e.raw_value, '$.value.refund_id') = refunds.refund_id
        LIMIT 1
    )
WHERE refund_id IN (
    SELECT json_extract(e.raw_value, '$.value.refund_id')
    FROM events e WHERE e.event_type = 'refund_approved'
);

-- Flip refunds to Rejected
UPDATE refunds
SET status = 'Rejected',
    resolved_at = (
        SELECT e.ledger_closed_at FROM events e
        WHERE e.event_type = 'refund_rejected'
          AND json_extract(e.raw_value, '$.value.refund_id') = refunds.refund_id
        LIMIT 1
    )
WHERE refund_id IN (
    SELECT json_extract(e.raw_value, '$.value.refund_id')
    FROM events e WHERE e.event_type = 'refund_rejected'
);

-- Flip refunds to Executed and accumulate refunded_total on payments
UPDATE refunds
SET status = 'Executed',
    resolved_at = (
        SELECT e.ledger_closed_at FROM events e
        WHERE e.event_type = 'refund_executed'
          AND json_extract(e.raw_value, '$.value.refund_id') = refunds.refund_id
        LIMIT 1
    )
WHERE refund_id IN (
    SELECT json_extract(e.raw_value, '$.value.refund_id')
    FROM events e WHERE e.event_type = 'refund_executed'
);

UPDATE payments
SET refunded_total = (
    SELECT COALESCE(SUM(r.amount), 0)
    FROM refunds r
    WHERE r.order_id = payments.order_id AND r.status = 'Executed'
),
status = CASE
    WHEN (
        SELECT COALESCE(SUM(r.amount), 0)
        FROM refunds r
        WHERE r.order_id = payments.order_id AND r.status = 'Executed'
    ) = 0 THEN 'Completed'
    WHEN (
        SELECT COALESCE(SUM(r.amount), 0)
        FROM refunds r
        WHERE r.order_id = payments.order_id AND r.status = 'Executed'
    ) >= payments.amount THEN 'FullyRefunded'
    ELSE 'PartiallyRefunded'
END;
SQL

success "Records reconstructed."

# ─── Apply optional filters ───────────────────────────────────────────────────
PAYMENT_FILTER_SQL="1=1"
REFUND_FILTER_SQL="1=1"

if [ -n "$DATE_FROM" ]; then
  PAYMENT_FILTER_SQL="${PAYMENT_FILTER_SQL} AND timestamp >= '${DATE_FROM}'"
  REFUND_FILTER_SQL="${REFUND_FILTER_SQL} AND initiated_at >= '${DATE_FROM}'"
fi

if [ -n "$DATE_TO" ]; then
  PAYMENT_FILTER_SQL="${PAYMENT_FILTER_SQL} AND timestamp <= '${DATE_TO}T23:59:59Z'"
  REFUND_FILTER_SQL="${REFUND_FILTER_SQL} AND initiated_at <= '${DATE_TO}T23:59:59Z'"
fi

if [ -n "$MERCHANT_FILTER" ]; then
  PAYMENT_FILTER_SQL="${PAYMENT_FILTER_SQL} AND merchant = '${MERCHANT_FILTER}'"
fi

# ─── Generate CSV output ─────────────────────────────────────────────────────
info "Writing CSV to: $OUTPUT_CSV"

python3 - <<PYEOF
import sqlite3, csv, sys

db = sqlite3.connect("${DB_FILE}")
db.row_factory = sqlite3.Row

rows = []

# Payments
for r in db.execute("""
    SELECT
        'payment' AS record_type,
        order_id,
        '' AS refund_id,
        payer,
        merchant,
        token,
        amount,
        refunded_total,
        status,
        memo,
        timestamp AS timestamp,
        '' AS resolved_at
    FROM payments
    WHERE ${PAYMENT_FILTER_SQL}
    ORDER BY timestamp ASC
"""):
    rows.append(dict(r))

# Refunds
for r in db.execute("""
    SELECT
        'refund' AS record_type,
        order_id,
        refund_id,
        '' AS payer,
        '' AS merchant,
        '' AS token,
        amount,
        0 AS refunded_total,
        status,
        reason AS memo,
        initiated_at AS timestamp,
        COALESCE(resolved_at, '') AS resolved_at
    FROM refunds
    WHERE ${REFUND_FILTER_SQL}
    ORDER BY initiated_at ASC
"""):
    rows.append(dict(r))

fields = [
    "record_type", "order_id", "refund_id", "payer", "merchant",
    "token", "amount", "refunded_total", "status", "memo",
    "timestamp", "resolved_at"
]

with open("${OUTPUT_CSV}", "w", newline="") as fh:
    writer = csv.DictWriter(fh, fieldnames=fields)
    writer.writeheader()
    writer.writerows(rows)

print(f"CSV written: {len(rows)} rows → ${OUTPUT_CSV}")
PYEOF

success "CSV written: $OUTPUT_CSV"

# ─── Summary stats ────────────────────────────────────────────────────────────
PAYMENT_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM payments WHERE ${PAYMENT_FILTER_SQL};")
TOTAL_VOLUME=$(sqlite3 "$DB_FILE" "SELECT COALESCE(SUM(amount),0) FROM payments WHERE ${PAYMENT_FILTER_SQL};")
REFUND_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM refunds WHERE ${REFUND_FILTER_SQL};")
EVENT_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM events;")

echo ""
echo "─────────────────────────────────────────"
echo " Replay Summary"
echo "─────────────────────────────────────────"
echo " Total events fetched : $EVENT_COUNT"
echo " Payments replayed    : $PAYMENT_COUNT"
echo " Total payment volume : $TOTAL_VOLUME stroops"
echo " Refunds replayed     : $REFUND_COUNT"
echo " Output CSV           : $OUTPUT_CSV"
echo " Database             : $DB_FILE"
echo "─────────────────────────────────────────"

# ─── Optional: validate against on-chain stats ────────────────────────────────
if [ "$VALIDATE" = "1" ]; then
  info "Validating replayed state against on-chain global stats..."

  ONCHAIN_STATS=$(stellar contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    -- get_global_payment_stats \
    --admin "${ADMIN_ADDRESS:-}" \
    --date_start "null" \
    --date_end "null" 2>&1) || {
      warn "Could not fetch on-chain stats (admin address may be required). Skipping validation."
      VALIDATE=0
    }

  if [ "$VALIDATE" = "1" ]; then
    ONCHAIN_COUNT=$(echo "$ONCHAIN_STATS" | jq -r '.payment_count // 0' 2>/dev/null || echo "0")

    if [ "$PAYMENT_COUNT" -ne "$ONCHAIN_COUNT" ]; then
      error "Validation FAILED: replayed $PAYMENT_COUNT payments, on-chain reports $ONCHAIN_COUNT"
      exit 3
    fi
    success "Validation PASSED: $PAYMENT_COUNT payments match on-chain count."
  fi
fi

success "Event replay complete."
