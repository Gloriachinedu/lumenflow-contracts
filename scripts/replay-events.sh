#!/usr/bin/env bash
# =============================================================================
# scripts/replay-events.sh
#
# Contract event replay tool for LumenFlow – closes #586
#
# Fetches all lumenflow/* contract events from Stellar Horizon, reconstructs
# payment and refund records into a local SQLite database, validates replayed
# state against on-chain data, and outputs a CSV of all replayed records.
#
# Usage:
#   ./scripts/replay-events.sh [OPTIONS]
#
# Options:
#   -c, --contract <ID>        Contract ID (required; or set LUMENFLOW_CONTRACT_ID)
#   -n, --network  <net>       Network: testnet|mainnet  (default: testnet)
#   -H, --horizon  <url>       Override Horizon base URL
#   -d, --db       <path>      SQLite database path (default: replay.db)
#   -o, --output   <path>      CSV output path (default: replay-events.csv)
#   --date-start   <ISO8601>   Filter events on or after this date/time
#   --date-end     <ISO8601>   Filter events on or before this date/time
#   --merchant     <address>   Filter records for a specific merchant
#   -v, --verbose              Print each event as it is processed
#   -h, --help                 Show this help
#
# Dependencies:
#   curl, jq, sqlite3 (all available on Ubuntu/macOS without extra installs)
#
# Examples:
#   # Full replay on testnet
#   LUMENFLOW_CONTRACT_ID=CABC... ./scripts/replay-events.sh
#
#   # Replay only July 2026, specific merchant
#   ./scripts/replay-events.sh \
#     --contract CABC... \
#     --date-start 2026-07-01T00:00:00Z \
#     --date-end   2026-07-31T23:59:59Z \
#     --merchant   GABC...
#
#   # Mainnet full replay to a custom DB and CSV
#   ./scripts/replay-events.sh \
#     --contract CABC... \
#     --network mainnet \
#     --db /data/lumenflow.db \
#     --output /data/lumenflow-replay.csv
# =============================================================================
set -euo pipefail

###############################################################################
# Defaults
###############################################################################
NETWORK="testnet"
HORIZON_TESTNET="https://horizon-testnet.stellar.org"
HORIZON_MAINNET="https://horizon.stellar.org"
HORIZON_URL=""
DB_PATH="replay.db"
CSV_PATH="replay-events.csv"
CONTRACT_ID="${LUMENFLOW_CONTRACT_ID:-}"
DATE_START=""
DATE_END=""
MERCHANT_FILTER=""
VERBOSE=false
PAGE_LIMIT=200      # max records per Horizon page

###############################################################################
# Colours
###############################################################################
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[INFO]${RESET}  $*"; }
success() { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
error()   { echo -e "${RED}[ERROR]${RESET} $*" >&2; }
die()     { error "$*"; exit 1; }

###############################################################################
# Argument parsing
###############################################################################
while [[ $# -gt 0 ]]; do
  case "$1" in
    -c|--contract)    CONTRACT_ID="$2";       shift 2 ;;
    -n|--network)     NETWORK="$2";           shift 2 ;;
    -H|--horizon)     HORIZON_URL="$2";       shift 2 ;;
    -d|--db)          DB_PATH="$2";           shift 2 ;;
    -o|--output)      CSV_PATH="$2";          shift 2 ;;
    --date-start)     DATE_START="$2";        shift 2 ;;
    --date-end)       DATE_END="$2";          shift 2 ;;
    --merchant)       MERCHANT_FILTER="$2";   shift 2 ;;
    -v|--verbose)     VERBOSE=true;           shift   ;;
    -h|--help)
      grep '^#' "$0" | grep -v '^#!/' | sed 's/^# \?//'
      exit 0 ;;
    *) die "Unknown option: $1. Run with --help for usage." ;;
  esac
done

###############################################################################
# Validation
###############################################################################
[[ -z "$CONTRACT_ID" ]] && die "Contract ID is required. Pass --contract or set LUMENFLOW_CONTRACT_ID."

for cmd in curl jq sqlite3; do
  command -v "$cmd" &>/dev/null || die "Required tool not found: $cmd"
done

if [[ -z "$HORIZON_URL" ]]; then
  case "$NETWORK" in
    testnet)  HORIZON_URL="$HORIZON_TESTNET" ;;
    mainnet)  HORIZON_URL="$HORIZON_MAINNET" ;;
    *)        die "Unknown network '$NETWORK'. Use testnet or mainnet, or pass --horizon." ;;
  esac
fi

###############################################################################
# Helpers
###############################################################################
iso_to_epoch() {
  # Converts an ISO-8601 string to a Unix epoch (seconds).
  local iso="$1"
  if date --version &>/dev/null 2>&1; then
    # GNU date
    date -d "$iso" +%s 2>/dev/null || echo ""
  else
    # BSD date (macOS)
    date -j -f "%Y-%m-%dT%H:%M:%SZ" "$iso" +%s 2>/dev/null || echo ""
  fi
}

epoch_to_iso() {
  local epoch="$1"
  if date --version &>/dev/null 2>&1; then
    date -d "@$epoch" -u +"%Y-%m-%dT%H:%M:%SZ"
  else
    date -r "$epoch" -u +"%Y-%m-%dT%H:%M:%SZ"
  fi
}

DATE_START_EPOCH=""
DATE_END_EPOCH=""
if [[ -n "$DATE_START" ]]; then
  DATE_START_EPOCH=$(iso_to_epoch "$DATE_START")
  [[ -z "$DATE_START_EPOCH" ]] && die "Cannot parse --date-start '$DATE_START'. Use ISO-8601 format."
fi
if [[ -n "$DATE_END" ]]; then
  DATE_END_EPOCH=$(iso_to_epoch "$DATE_END")
  [[ -z "$DATE_END_EPOCH" ]] && die "Cannot parse --date-end '$DATE_END'. Use ISO-8601 format."
fi

###############################################################################
# Database initialisation
###############################################################################
info "Initialising database: $DB_PATH"
sqlite3 "$DB_PATH" <<'SQL'
PRAGMA journal_mode = WAL;
PRAGMA synchronous  = NORMAL;

CREATE TABLE IF NOT EXISTS payments (
  order_id        TEXT PRIMARY KEY,
  payer           TEXT,
  merchant        TEXT,
  token           TEXT,
  amount          INTEGER,
  memo            TEXT,
  status          TEXT DEFAULT 'Completed',
  refunded_amount INTEGER DEFAULT 0,
  paid_at         TEXT,
  ledger          INTEGER,
  tx_hash         TEXT
);

CREATE TABLE IF NOT EXISTS refunds (
  refund_id   TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL,
  initiator   TEXT,
  merchant    TEXT,
  amount      INTEGER,
  reason      TEXT,
  status      TEXT DEFAULT 'Pending',
  initiated_at TEXT,
  resolved_at  TEXT,
  ledger       INTEGER,
  tx_hash      TEXT
);

CREATE TABLE IF NOT EXISTS raw_events (
  event_id      TEXT PRIMARY KEY,
  paging_token  TEXT,
  ledger        INTEGER,
  ledger_closed_at TEXT,
  event_type    TEXT,
  value_json    TEXT
);

CREATE TABLE IF NOT EXISTS replay_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
SQL
success "Database ready."

###############################################################################
# Fetch and store all events
###############################################################################
TOTAL_EVENTS=0
CURSOR="0"
REPLAY_START=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

info "Fetching events from $HORIZON_URL for contract $CONTRACT_ID …"

while true; do
  URL="${HORIZON_URL}/contracts/${CONTRACT_ID}/events?cursor=${CURSOR}&order=asc&limit=${PAGE_LIMIT}"
  RESPONSE=$(curl -sf "$URL" || die "Horizon request failed: $URL")

  RECORDS=$(echo "$RESPONSE" | jq -c '._embedded.records // []')
  COUNT=$(echo "$RECORDS" | jq 'length')

  if [[ "$COUNT" -eq 0 ]]; then
    break
  fi

  # Process each event
  while IFS= read -r event; do
    EVENT_ID=$(echo "$event" | jq -r '.id')
    PAGING_TOKEN=$(echo "$event" | jq -r '.paging_token')
    LEDGER=$(echo "$event" | jq -r '.ledger')
    CLOSED_AT=$(echo "$event" | jq -r '.ledger_closed_at // ""')
    TOPIC=$(echo "$event" | jq -r '.topic // [] | .[1] // ""')
    VALUE_JSON=$(echo "$event" | jq -c '.value // {}')

    # Date filter – skip events outside the requested window
    if [[ -n "$CLOSED_AT" ]]; then
      EVENT_EPOCH=$(iso_to_epoch "$CLOSED_AT")
      if [[ -n "$DATE_START_EPOCH" && "$EVENT_EPOCH" -lt "$DATE_START_EPOCH" ]]; then
        CURSOR="$PAGING_TOKEN"
        continue
      fi
      if [[ -n "$DATE_END_EPOCH" && "$EVENT_EPOCH" -gt "$DATE_END_EPOCH" ]]; then
        # Past the end window – stop fetching entirely
        CURSOR="EOF"
        break
      fi
    fi

    $VERBOSE && info "Event [$TOPIC] ledger=$LEDGER at $CLOSED_AT"

    # Persist raw event (ignore duplicate inserts)
    sqlite3 "$DB_PATH" \
      "INSERT OR IGNORE INTO raw_events VALUES (
        $(printf '%q' "$EVENT_ID"),
        $(printf '%q' "$PAGING_TOKEN"),
        $LEDGER,
        $(printf '%q' "$CLOSED_AT"),
        $(printf '%q' "$TOPIC"),
        $(printf '%q' "$VALUE_JSON")
      );"

    # ── Reconstruct domain records ──────────────────────────────────────────

    case "$TOPIC" in

      payment_processed)
        ORDER_ID=$(echo "$VALUE_JSON" | jq -r '.order_id // ""')
        PAYER=$(echo "$VALUE_JSON" | jq -r '.payer // ""')
        MERCHANT=$(echo "$VALUE_JSON" | jq -r '.merchant_address // ""')
        TOKEN=$(echo "$VALUE_JSON" | jq -r '.token_address // ""')
        AMOUNT=$(echo "$VALUE_JSON" | jq -r '.amount // 0')
        MEMO=$(echo "$VALUE_JSON" | jq -r '.memo // ""')
        TX_HASH=$(echo "$event" | jq -r '.transaction_hash // ""')

        if [[ -n "$ORDER_ID" ]]; then
          sqlite3 "$DB_PATH" \
            "INSERT OR REPLACE INTO payments
               (order_id, payer, merchant, token, amount, memo, status, refunded_amount, paid_at, ledger, tx_hash)
             VALUES (
               $(printf '%q' "$ORDER_ID"),
               $(printf '%q' "$PAYER"),
               $(printf '%q' "$MERCHANT"),
               $(printf '%q' "$TOKEN"),
               $AMOUNT,
               $(printf '%q' "$MEMO"),
               'Completed', 0,
               $(printf '%q' "$CLOSED_AT"),
               $LEDGER,
               $(printf '%q' "$TX_HASH")
             );"
        fi
        ;;

      refund_initiated)
        REFUND_ID=$(echo "$VALUE_JSON" | jq -r '.refund_id // ""')
        ORDER_ID=$(echo "$VALUE_JSON" | jq -r '.order_id // ""')
        INITIATOR=$(echo "$VALUE_JSON" | jq -r '.caller // ""')
        MERCHANT=$(echo "$VALUE_JSON" | jq -r '.merchant_address // ""')
        AMOUNT=$(echo "$VALUE_JSON" | jq -r '.amount // 0')
        REASON=$(echo "$VALUE_JSON" | jq -r '.reason // ""')

        if [[ -n "$REFUND_ID" ]]; then
          sqlite3 "$DB_PATH" \
            "INSERT OR IGNORE INTO refunds
               (refund_id, order_id, initiator, merchant, amount, reason, status, initiated_at, ledger)
             VALUES (
               $(printf '%q' "$REFUND_ID"),
               $(printf '%q' "$ORDER_ID"),
               $(printf '%q' "$INITIATOR"),
               $(printf '%q' "$MERCHANT"),
               $AMOUNT,
               $(printf '%q' "$REASON"),
               'Pending',
               $(printf '%q' "$CLOSED_AT"),
               $LEDGER
             );"
        fi
        ;;

      refund_approved)
        REFUND_ID=$(echo "$VALUE_JSON" | jq -r '.refund_id // ""')
        [[ -n "$REFUND_ID" ]] && sqlite3 "$DB_PATH" \
          "UPDATE refunds SET status='Approved' WHERE refund_id=$(printf '%q' "$REFUND_ID");"
        ;;

      refund_rejected)
        REFUND_ID=$(echo "$VALUE_JSON" | jq -r '.refund_id // ""')
        [[ -n "$REFUND_ID" ]] && sqlite3 "$DB_PATH" \
          "UPDATE refunds SET status='Rejected', resolved_at=$(printf '%q' "$CLOSED_AT")
           WHERE refund_id=$(printf '%q' "$REFUND_ID");"
        ;;

      refund_executed)
        REFUND_ID=$(echo "$VALUE_JSON" | jq -r '.refund_id // ""')
        ORDER_ID=$(echo "$VALUE_JSON" | jq -r '.order_id // ""')
        REFUND_AMT=$(echo "$VALUE_JSON" | jq -r '.amount // 0')

        if [[ -n "$REFUND_ID" ]]; then
          sqlite3 "$DB_PATH" \
            "UPDATE refunds SET status='Completed', resolved_at=$(printf '%q' "$CLOSED_AT")
             WHERE refund_id=$(printf '%q' "$REFUND_ID");"
        fi
        if [[ -n "$ORDER_ID" ]]; then
          # Update cumulative refunded_amount on the payment; update status
          sqlite3 "$DB_PATH" <<SQL2
UPDATE payments
SET refunded_amount = refunded_amount + $REFUND_AMT,
    status = CASE
      WHEN refunded_amount + $REFUND_AMT >= amount THEN 'FullyRefunded'
      ELSE 'PartiallyRefunded'
    END
WHERE order_id = $(printf '%q' "$ORDER_ID");
SQL2
        fi
        ;;

      *) $VERBOSE && info "Skipping non-payment event: $TOPIC" ;;
    esac

    CURSOR="$PAGING_TOKEN"
    TOTAL_EVENTS=$((TOTAL_EVENTS + 1))

  done < <(echo "$RECORDS" | jq -c '.[]')

  [[ "$CURSOR" == "EOF" ]] && break
  [[ "$COUNT" -lt "$PAGE_LIMIT" ]] && break   # last page
done

success "Fetched and processed $TOTAL_EVENTS events."

###############################################################################
# On-chain state validation
###############################################################################
info "Validating replayed state …"

ERRORS=0

# Check: every payment should have refunded_amount <= amount
BAD_REFUNDS=$(sqlite3 "$DB_PATH" \
  "SELECT order_id FROM payments WHERE refunded_amount > amount;" | wc -l)
if [[ "$BAD_REFUNDS" -gt 0 ]]; then
  warn "Validation: $BAD_REFUNDS payment(s) have refunded_amount > original amount."
  ERRORS=$((ERRORS + BAD_REFUNDS))
fi

# Check: all refund statuses are valid
BAD_STATUSES=$(sqlite3 "$DB_PATH" \
  "SELECT count(*) FROM refunds
   WHERE status NOT IN ('Pending','Approved','Rejected','Completed');" | tr -d '[:space:]')
if [[ "$BAD_STATUSES" -gt 0 ]]; then
  warn "Validation: $BAD_STATUSES refund(s) have unrecognised status values."
  ERRORS=$((ERRORS + BAD_STATUSES))
fi

# Check: refunds reference existing orders
ORPHAN_REFUNDS=$(sqlite3 "$DB_PATH" \
  "SELECT count(*) FROM refunds r
   LEFT JOIN payments p ON r.order_id = p.order_id
   WHERE p.order_id IS NULL;" | tr -d '[:space:]')
if [[ "$ORPHAN_REFUNDS" -gt 0 ]]; then
  warn "Validation: $ORPHAN_REFUNDS refund(s) reference unknown order IDs."
  ERRORS=$((ERRORS + ORPHAN_REFUNDS))
fi

if [[ "$ERRORS" -eq 0 ]]; then
  success "State validation passed – no inconsistencies found."
else
  warn "Validation completed with $ERRORS issue(s). Review warnings above."
fi

# Persist validation result
sqlite3 "$DB_PATH" \
  "INSERT OR REPLACE INTO replay_meta VALUES ('last_replay_at', '$(date -u +"%Y-%m-%dT%H:%M:%SZ")');
   INSERT OR REPLACE INTO replay_meta VALUES ('validation_errors', '$ERRORS');
   INSERT OR REPLACE INTO replay_meta VALUES ('total_events', '$TOTAL_EVENTS');"

###############################################################################
# CSV export
###############################################################################
info "Exporting CSV to $CSV_PATH …"

# Build merchant WHERE clause
MERCHANT_WHERE=""
if [[ -n "$MERCHANT_FILTER" ]]; then
  MERCHANT_WHERE="AND p.merchant = '${MERCHANT_FILTER//\'/\'\'}'"
fi

# Build date WHERE clauses
DATE_WHERE=""
if [[ -n "$DATE_START" ]]; then
  DATE_WHERE="$DATE_WHERE AND p.paid_at >= '${DATE_START//\'/\'\'}'"
fi
if [[ -n "$DATE_END" ]]; then
  DATE_WHERE="$DATE_WHERE AND p.paid_at <= '${DATE_END//\'/\'\'}'"
fi

sqlite3 -csv -header "$DB_PATH" <<SQL > "$CSV_PATH"
SELECT
  p.order_id,
  p.payer,
  p.merchant,
  p.token,
  p.amount,
  p.refunded_amount,
  p.status             AS payment_status,
  p.memo,
  p.paid_at,
  p.ledger             AS payment_ledger,
  p.tx_hash            AS payment_tx_hash,
  COALESCE(r.refund_id, '')  AS refund_id,
  COALESCE(r.amount, 0)      AS refund_amount,
  COALESCE(r.reason, '')     AS refund_reason,
  COALESCE(r.status, '')     AS refund_status,
  COALESCE(r.initiated_at, '') AS refund_initiated_at,
  COALESCE(r.resolved_at, '')  AS refund_resolved_at
FROM payments p
LEFT JOIN refunds r ON r.order_id = p.order_id
WHERE 1=1
  $MERCHANT_WHERE
  $DATE_WHERE
ORDER BY p.paid_at ASC;
SQL

CSV_ROWS=$(wc -l < "$CSV_PATH")
success "CSV written: $CSV_PATH ($((CSV_ROWS - 1)) data rows)"

###############################################################################
# Summary
###############################################################################
TOTAL_PAYMENTS=$(sqlite3 "$DB_PATH" "SELECT count(*) FROM payments;" | tr -d '[:space:]')
TOTAL_REFUNDS=$(sqlite3  "$DB_PATH" "SELECT count(*) FROM refunds;"  | tr -d '[:space:]')

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  LumenFlow Event Replay – Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Contract   : $CONTRACT_ID"
echo "  Network    : $NETWORK ($HORIZON_URL)"
echo "  Events     : $TOTAL_EVENTS"
echo "  Payments   : $TOTAL_PAYMENTS"
echo "  Refunds    : $TOTAL_REFUNDS"
echo "  Errors     : $ERRORS"
echo "  Database   : $DB_PATH"
echo "  CSV        : $CSV_PATH"
echo "  Completed  : $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

if [[ "$ERRORS" -eq 0 ]]; then
  success "Replay complete. ✅"
else
  warn "Replay complete with warnings. Review the output above."
  exit 1
fi
