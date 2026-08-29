#!/usr/bin/env bash
# scripts/generate_smoke_keypair.sh
#
# Generates a throwaway ed25519 keypair and signs the canonical LumenFlow
# payment payload, then prints environment variable exports for SMOKE_SIG,
# SMOKE_PUBKEY, and SMOKE_NONCE for consumption by smoke_test.sh.
#
# Usage (called by smoke_test.sh automatically, or run standalone):
#
#   eval "$(./scripts/generate_smoke_keypair.sh \
#     --contract-id  <CONTRACT_ID> \
#     --merchant     <MERCHANT_ADDRESS> \
#     --order-id     <ORDER_ID> \
#     --amount       <AMOUNT> \
#     --network      testnet)"
#
# The script writes a temporary Node.js script, runs it, then cleans up.
# Node.js ≥ 18 and npm must be available (always true on ubuntu-latest).
#
# Payload layout (see docs/signature-format.md):
#   network_id        32 bytes  SHA-256(network_passphrase)
#   contract_address  variable  XDR-encoded ScAddress
#   nonce             8 bytes   big-endian u64 (current_nonce + 1)
#   order_id          variable  XDR ScVal String
#   amount            16 bytes  big-endian i128
#
# Output (to stdout, suitable for eval):
#   export SMOKE_SIG=<128-char hex>
#   export SMOKE_PUBKEY=<64-char hex>
#   export SMOKE_NONCE=<decimal u64>
#
set -euo pipefail

# ── argument parsing ──────────────────────────────────────────────────────────
CONTRACT_ID=""
MERCHANT_ADDRESS=""
ORDER_ID=""
AMOUNT="1"
NETWORK="testnet"
STELLAR_RPC_URL=""

usage() {
  echo "Usage: $0 --contract-id <id> --merchant <address> --order-id <id>" >&2
  echo "          [--amount <int>] [--network testnet|mainnet|local]" >&2
  echo "          [--rpc-url <url>]" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --contract-id)  CONTRACT_ID="$2";      shift 2 ;;
    --merchant)     MERCHANT_ADDRESS="$2"; shift 2 ;;
    --order-id)     ORDER_ID="$2";         shift 2 ;;
    --amount)       AMOUNT="$2";           shift 2 ;;
    --network)      NETWORK="$2";          shift 2 ;;
    --rpc-url)      STELLAR_RPC_URL="$2";  shift 2 ;;
    *) echo "Unknown argument: $1" >&2; usage ;;
  esac
done

[[ -z "$CONTRACT_ID"     ]] && { echo "ERROR: --contract-id is required" >&2; usage; }
[[ -z "$MERCHANT_ADDRESS" ]] && { echo "ERROR: --merchant is required"    >&2; usage; }
[[ -z "$ORDER_ID"        ]] && { echo "ERROR: --order-id is required"     >&2; usage; }

# ── resolve network passphrase & RPC URL ────────────────────────────────────
case "$NETWORK" in
  testnet)
    PASSPHRASE="Test SDF Network ; September 2015"
    DEFAULT_RPC="https://soroban-testnet.stellar.org"
    ;;
  mainnet|public)
    PASSPHRASE="Public Global Stellar Network ; September 2015"
    DEFAULT_RPC="https://mainnet.sorobanrpc.com"
    ;;
  local|standalone)
    PASSPHRASE="Standalone Network ; February 2017"
    DEFAULT_RPC="http://localhost:8000/soroban/rpc"
    ;;
  *)
    echo "ERROR: unknown network '$NETWORK'" >&2; exit 1 ;;
esac

STELLAR_RPC_URL="${STELLAR_RPC_URL:-$DEFAULT_RPC}"

# ── check for Node.js ────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "ERROR: node is required but not found in PATH." >&2
  echo "       Install Node.js >= 18 or use SMOKE_SIG / SMOKE_PUBKEY overrides." >&2
  exit 1
fi

NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "ERROR: Node.js >= 18 is required (found v${NODE_MAJOR})" >&2
  exit 1
fi

# ── install @stellar/stellar-sdk if not cached ───────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SMOKE_NODE_DIR="${SCRIPT_DIR}/.smoke_node_modules"

if [[ ! -d "${SMOKE_NODE_DIR}/node_modules/@stellar/stellar-sdk" ]]; then
  mkdir -p "${SMOKE_NODE_DIR}"
  cd "${SMOKE_NODE_DIR}"
  # Minimal package.json to allow npm install
  if [[ ! -f package.json ]]; then
    echo '{"name":"smoke-signer","version":"1.0.0","private":true}' > package.json
  fi
  npm install --save-exact --no-audit --no-fund "@stellar/stellar-sdk@13.8.0" 2>&1 | \
    grep -v "^npm warn" || true
  cd - >/dev/null
fi

# ── write temporary signing script ───────────────────────────────────────────
TMPDIR_SMOKE="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_SMOKE"' EXIT

cat > "${TMPDIR_SMOKE}/sign.mjs" << 'NODEJS_EOF'
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { Address, xdr } from '@stellar/stellar-sdk';

const [,, networkPassphrase, contractId, merchantAddress, nonce, orderId, amount, rpcUrl] =
  process.argv;

// ── 1. Generate throwaway ed25519 keypair ─────────────────────────────────
const { privateKey, publicKey } = generateKeyPairSync('ed25519');

// Export raw 32-byte public key
const pubkeyDer  = publicKey.export({ type: 'spki', format: 'der' });
// DER SPKI for ed25519 has a 12-byte header; raw key starts at byte 12
const pubkeyRaw  = pubkeyDer.slice(12);   // 32 bytes

// ── 2. Build the canonical payload ────────────────────────────────────────
// 2a. network_id = SHA-256(passphrase)
const networkId = createHash('sha256').update(networkPassphrase, 'utf8').digest();

// 2b. contract_address XDR
const contractAddrXdr = Address.fromString(contractId).toScAddress().toXDR();

// 2c. nonce as 8-byte big-endian u64
const nonceBuf = Buffer.alloc(8);
nonceBuf.writeBigUInt64BE(BigInt(nonce), 0);

// 2d. order_id as XDR ScVal String (SCV_STRING tag = 14)
const orderIdXdr = xdr.ScVal.scvString(orderId).toXDR();

// 2e. amount as 16-byte big-endian i128
const amountBig = BigInt(amount);
const amountBuf = Buffer.alloc(16);
// High 8 bytes then low 8 bytes
const hi = amountBig >> 64n;
const lo = amountBig & 0xFFFFFFFFFFFFFFFFn;
amountBuf.writeBigInt64BE(hi, 0);
// Write lo as unsigned (the lower 64 bits are always non-negative in big-endian i128)
const loBuf = Buffer.alloc(8);
const loView = new DataView(loBuf.buffer);
loView.setBigUint64(0, lo, false);
loBuf.copy(amountBuf, 8);

const payload = Buffer.concat([
  networkId,
  contractAddrXdr,
  nonceBuf,
  orderIdXdr,
  amountBuf,
]);

// ── 3. Sign with ed25519 ──────────────────────────────────────────────────
// Node's crypto.sign for ed25519 does not accept a hash algorithm
const signature = sign(null, payload, privateKey);   // 64 bytes

// ── 4. Print exports ──────────────────────────────────────────────────────
console.log(`export SMOKE_SIG=${signature.toString('hex')}`);
console.log(`export SMOKE_PUBKEY=${pubkeyRaw.toString('hex')}`);
console.log(`export SMOKE_NONCE=${nonce}`);
NODEJS_EOF

# ── query current merchant nonce from the chain ──────────────────────────────
# We use stellar contract invoke to read the nonce (read-only call).
CURRENT_NONCE=0
if command -v stellar &>/dev/null; then
  RAW_NONCE=$(stellar contract invoke \
    --id "$CONTRACT_ID" \
    --network "$NETWORK" \
    --source-account "$MERCHANT_ADDRESS" \
    -- get_merchant_nonce \
    --merchant_address "$MERCHANT_ADDRESS" 2>/dev/null || echo "0")
  # stellar CLI returns JSON-like output; strip quotes/whitespace
  CURRENT_NONCE=$(echo "$RAW_NONCE" | tr -d '"' | xargs || echo "0")
  CURRENT_NONCE=$(( CURRENT_NONCE + 0 ))   # ensure numeric
fi
NONCE=$(( CURRENT_NONCE + 1 ))

# ── run the Node.js signer ───────────────────────────────────────────────────
NODE_PATH="${SMOKE_NODE_DIR}/node_modules" \
  node "${TMPDIR_SMOKE}/sign.mjs" \
    "$PASSPHRASE" \
    "$CONTRACT_ID" \
    "$MERCHANT_ADDRESS" \
    "$NONCE" \
    "$ORDER_ID" \
    "$AMOUNT" \
    "$STELLAR_RPC_URL"
