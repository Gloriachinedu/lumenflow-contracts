# LumenFlow

**Scalable, secure, and decentralized smart contracts for Soroban on Stellar.**

[![CI](https://github.com/Gloriachinedu/lumenflow-contracts/actions/workflows/ci.yml/badge.svg)](https://github.com/Gloriachinedu/lumenflow-contracts/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Stellar](https://img.shields.io/badge/Stellar-Soroban-blueviolet)](https://soroban.stellar.org)
[![Discord](https://img.shields.io/discord/123456789012345678?color=7289da&label=Discord&logo=discord&logoColor=ffffff)](https://discord.gg/lumenflow)

---

## Overview

LumenFlow is a production-grade payment processing smart contract for the [Stellar Soroban](https://soroban.stellar.org) network. It provides:

- **Merchant management** — registration, profiles, deactivation
- **Payment processing** — ed25519 signature-verified token transfers
- **Refund lifecycle** — initiate → approve/reject → execute
- **Multi-signature payments** — configurable threshold approvals
- **Payment history queries** — paginated, filtered, and sorted
- **Admin controls** — global stats, archiving, automated cleanup

---

## Prerequisites

| Tool | Install |
|------|---------|
| Rust (stable) | https://rustup.rs |
| Stellar CLI | https://developers.stellar.org/docs/tools/stellar-cli |
| Docker Desktop (local network) | https://www.docker.com/products/docker-desktop |

Verify:

```bash
rustc --version
cargo --version
stellar --version
docker --version
```

Add the WASM target:

```bash
rustup target add wasm32-unknown-unknown
```

---

## Project Structure

```
lumenflow-contracts/
├── contracts/
│   └── lumenflow/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs        # Contract entry points
│           ├── types.rs      # Data structures
│           ├── storage.rs    # Persistent storage helpers
│           ├── error.rs      # Typed error codes
│           ├── helper.rs     # Auth & validation utilities
│           └── test.rs       # Unit tests
├── scripts/
│   ├── deploy.sh             # Build + deploy helper
│   └── test.sh               # Lint + test runner
├── .github/
│   ├── workflows/
│   │   ├── ci.yml            # Lint, test, WASM build
│   │   └── release.yml       # Tag-triggered release
│   ├── ISSUE_TEMPLATE/
│   └── PULL_REQUEST_TEMPLATE.md
├── Cargo.toml                # Workspace manifest
├── rust-toolchain.toml
├── CHANGELOG.md
├── CONTRIBUTING.md
├── LICENSE
└── SECURITY.md
```

## Merchant Onboarding

New merchants can register through the following flow:

1. **Connect Wallet**: Ensure your Stellar wallet is connected.
2. **Check Registration**: Call `is_registered(address)` to check if you already have a profile.
3. **Register**: Call `register_merchant` with your business details and category.
4. **Verification**: Upon success, you will be redirected to the dashboard where you can start accepting payments.

Existing profiles can be retrieved using `get_merchant(address)`.

---

## Build

```bash
# From the workspace root
cargo build --target wasm32-unknown-unknown --release --package lumenflow
```

The compiled WASM is at:

```
target/wasm32-unknown-unknown/release/lumenflow.wasm
```

---

## Testing

```bash
# Run all tests
cargo test --all-features

# Run a specific test
cargo test test_successful_refund_flow

# Full lint + test pipeline
./scripts/test.sh
```

Test coverage includes:

- Merchant registration and deactivation
- Payment processing with signature verification
- Duplicate order ID rejection
- Refund initiation, approval, rejection, and execution
- Refund window and amount validation
- Multi-signature payment threshold enforcement
- Paginated history queries with filters and sorting
- Global statistics tracking
- Payment cleanup by age

---

## Local Network Setup

```bash
# 1. Start Docker Desktop, then:
stellar network container start local

# 2. Build and deploy
NETWORK=local SOURCE_ACCOUNT=<secret-key> ./scripts/deploy.sh

# 3. Initialise admin
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source-account <admin-secret-key> \
  --network local \
  -- set_admin \
  --admin <admin-address>
```

---

## Contract API

### Admin

```bash
# Set admin (one-time)
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- set_admin --admin <admin-address>

# Set payment cleanup period (seconds)
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- set_payment_cleanup_period --admin <admin-address> --period 7776000
```

### Merchant Management

```bash
# Register
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY --network $NETWORK \
  -- register_merchant \
  --merchant_address <address> \
  --name "My Store" \
  --description "Store description" \
  --contact_info "contact@store.com" \
  --category Retail

# Deactivate (admin only)
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- deactivate_merchant --admin <admin-address> --merchant_address <address>

# Get merchant info
stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY --network $NETWORK \
  -- get_merchant --merchant_address <address>
```

### Payment Processing

#### Signature payload format

`process_payment_with_signature` and `batch_payment` verify an ed25519 signature over a deterministic payload:

```
payload = XDR(order_id) || amount_be_i128
```

Byte layout:

| Bytes | Content |
|-------|---------|
| `[0..3]` | `u32` big-endian — UTF-8 length of `order_id` (XDR String length prefix) |
| `[4..4+N)` | UTF-8 bytes of `order_id` (N = length prefix value) |
| `[4+N..4+N+P)` | 0–3 zero-padding bytes so the XDR block is a multiple of 4 |
| `[4+N+P..4+N+P+16]` | `i128` big-endian — payment amount (16 bytes) |

Example — `order_id = "ORD1"` (4 bytes), `amount = 1000`:

```
00 00 00 04  4F 52 44 31  00 00 00 00 00 00 00 00 00 00 03 E8
^-- len=4    ^-- "ORD1"   ^-- no padding  ^-- 1000 as i128 BE
```

Off-chain signing (pseudocode, works in any language):

```python
import struct, hashlib
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

order_id_bytes = order_id.encode("utf-8")
n = len(order_id_bytes)
padding = (4 - (n % 4)) % 4
payload = struct.pack(">I", n) + order_id_bytes + b"\x00" * padding + amount.to_bytes(16, "big", signed=True)
signature = private_key.sign(payload)
```

```bash
# Process payment with signature
stellar contract invoke --id $CONTRACT_ID --source-account $PAYER_KEY --network $NETWORK \
  -- process_payment_with_signature \
  --payer <payer-address> \
  --order_id "ORDER_001" \
  --merchant_address <merchant-address> \
  --token_address <token-address> \
  --amount 1000 \
  --memo "Invoice #001" \
  --signature <ed25519-signature-bytes> \
  --merchant_public_key <ed25519-public-key-bytes>

# Get payment by ID
stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY --network $NETWORK \
  -- get_payment_by_id --caller <caller-address> --order_id "ORDER_001"

# Archive payment (admin only)
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- archive_payment_record --admin <admin-address> --order_id "ORDER_001"

# Cleanup expired payments (admin only)
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- cleanup_expired_payments --admin <admin-address>
```

### Payment History Queries

```bash
# Merchant history (paginated, sorted by date descending)
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY --network $NETWORK \
  -- get_merchant_payment_history \
  --merchant <merchant-address> \
  --cursor null \
  --limit 10 \
  --filter null \
  --sort_field Date \
  --sort_order Descending

# Payer history with amount filter
stellar contract invoke --id $CONTRACT_ID --source-account $PAYER_KEY --network $NETWORK \
  -- get_payer_payment_history \
  --payer <payer-address> \
  --cursor null \
  --limit 10 \
  --filter '{"amount_min":100,"amount_max":5000,"status":"Any"}' \
  --sort_field Amount \
  --sort_order Ascending

# Global stats (admin only)
stellar contract invoke --id $CONTRACT_ID --source-account $ADMIN_KEY --network $NETWORK \
  -- get_global_payment_stats \
  --admin <admin-address> \
  --date_start null \
  --date_end null
```

**Filter fields:** `date_start`, `date_end`, `amount_min`, `amount_max`, `token`, `status` (`Any` | `Completed` | `PartiallyRefunded` | `FullyRefunded`)

**Sort fields:** `Date` | `Amount`  
**Sort orders:** `Ascending` | `Descending`  
**Pagination:** cursor-based using `order_id`; max 100 results per page.

### Refunds

Refund rules:
- Window: 30 days from `paid_at`
- Partial refunds allowed; cumulative total cannot exceed original amount
- Initiator: payer or merchant
- Approver/Rejector: merchant or admin
- Executor: merchant (signs the token transfer)

```bash
# Initiate
stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY --network $NETWORK \
  -- initiate_refund \
  --caller <caller-address> \
  --refund_id "REFUND_001" \
  --order_id "ORDER_001" \
  --amount 500 \
  --reason "Customer request"

# Approve
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY --network $NETWORK \
  -- approve_refund --caller <merchant-address> --refund_id "REFUND_001"

# Reject
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY --network $NETWORK \
  -- reject_refund --caller <merchant-address> --refund_id "REFUND_001"

# Execute (merchant signs the transfer)
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY --network $NETWORK \
  -- execute_refund --refund_id "REFUND_001"

# Get refund status
stellar contract invoke --id $CONTRACT_ID --source-account $CALLER_KEY --network $NETWORK \
  -- get_refund --refund_id "REFUND_001"
```

### Multi-Signature Payments

```bash
# Initiate
stellar contract invoke --id $CONTRACT_ID --source-account $INITIATOR_KEY --network $NETWORK \
  -- initiate_multisig_payment \
  --initiator <initiator-address> \
  --payment_id "MS_001" \
  --merchant_address <merchant-address> \
  --token_address <token-address> \
  --amount 5000 \
  --signers '["<signer1>","<signer2>"]' \
  --required_signatures 2

# Sign
stellar contract invoke --id $CONTRACT_ID --source-account $SIGNER_KEY --network $NETWORK \
  -- sign_multisig_payment \
  --signer <signer-address> \
  --payment_id "MS_001" \
  --signature <signature-bytes>

# Execute (once threshold met)
stellar contract invoke --id $CONTRACT_ID --source-account $PAYER_KEY --network $NETWORK \
  -- execute_multisig_payment --payer <payer-address> --payment_id "MS_001"
```

---

## Events

| Event name | Trigger |
|---|---|
| `lumenflow/admin_set` | Admin initialised |
| `lumenflow/merchant_registered` | New merchant registered |
| `lumenflow/payment_processed` | Payment completed |
| `lumenflow/payment_archived` | Payment record removed |
| `lumenflow/refund_initiated` | Refund request opened |
| `lumenflow/refund_approved` | Refund approved |
| `lumenflow/refund_rejected` | Refund rejected |
| `lumenflow/refund_executed` | Refund transfer completed |
| `lumenflow/multisig_initiated` | Multisig payment created |
| `lumenflow/multisig_executed` | Multisig payment executed |

---

## Testnet Deployment

```bash
NETWORK=testnet SOURCE_ACCOUNT=<testnet-secret-key> ./scripts/deploy.sh
```

Get testnet XLM from the [Stellar Friendbot](https://friendbot.stellar.org).

---

## Troubleshooting

**WASM target missing:**
```bash
rustup target add wasm32-unknown-unknown
```

**Local network fails to start:**
```bash
stellar network container restart local
```

**Insufficient XLM for fees:** Fund your account via Friendbot (testnet) or acquire XLM (mainnet).

**Test failures:** Ensure `soroban-sdk` version in `Cargo.toml` matches `rust-toolchain.toml` channel.

---

## Community & Support

Need help or want to discuss LumenFlow?

- **Discord Server:** Join our [Discord community](https://discord.gg/lumenflow) to chat with developers and other users.
- **GitHub Discussions:** Ask questions and share ideas in [GitHub Discussions](https://github.com/Gloriachinedu/lumenflow-contracts/discussions).
- **Support Guidelines:** See [SUPPORT.md](SUPPORT.md) for details on where to get help and how to report bugs.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All contributions are welcome — bug fixes, features, documentation, and tests.

## Security

See [SECURITY.md](SECURITY.md) for responsible disclosure instructions.

## License

[MIT](LICENSE) © 2026 LumenFlow Contributors
