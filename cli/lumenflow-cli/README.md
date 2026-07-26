# lumenflow-cli

Command-line interface for interacting with the LumenFlow smart contract on Stellar Soroban.

## Installation

```bash
cargo build --release --package lumenflow-cli
# Binary: target/release/lumenflow
```

## Configuration

The CLI reads config from `.lumenflow.toml` in the working directory, with environment variables taking precedence.

**.lumenflow.toml**
```toml
network        = "testnet"          # testnet | mainnet | local
contract_id    = "CXXXXXXXXXXXXXXX" # deployed contract address
source_account = "SXXXXXXXXXXXXXXX" # secret key or alias
```

**Environment variables**
| Variable               | Description                 |
|------------------------|-----------------------------|
| `LUMENFLOW_NETWORK`    | Override `network`          |
| `LUMENFLOW_CONTRACT_ID`| Override `contract_id`      |
| `LUMENFLOW_SOURCE`     | Override `source_account`   |

---

## Commands

### pay

Process a payment to a merchant.

```bash
lumenflow pay \
  --merchant GMERCHANT... \
  --amount 1000 \
  --order-id "ORDER_001"
```

### refund init

Initiate a refund for an existing payment.

```bash
lumenflow refund init \
  --order-id "ORDER_001" \
  --amount 500
```

### history

View paginated payment history for a merchant.

```bash
lumenflow history --merchant GMERCHANT...
```

### stats

View global contract statistics (admin only).

```bash
lumenflow stats
```

---

## Multisig Commands

Multi-signature payments require a configurable number of approvals before funds are released.

### multisig init

Initiate a new multisig payment. Calls `initiate_multisig_payment` on the contract.

```bash
lumenflow multisig init \
  --payment-id "MS_001" \
  --merchant  GMERCHANT... \
  --token     CTOKEN... \
  --amount    5000 \
  --signers   "GSIGNER1...,GSIGNER2...,GSIGNER3..." \
  --required  2
```

| Flag            | Description                                         |
|-----------------|-----------------------------------------------------|
| `--payment-id`  | Unique identifier for this multisig payment         |
| `--merchant`    | Merchant address that will receive the funds        |
| `--token`       | SAC token address used for the payment              |
| `--amount`      | Amount in token base units                          |
| `--signers`     | Comma-separated list of authorised signer addresses |
| `--required`    | Minimum signatures needed to execute                |

---

### multisig sign

Add your signature to a pending multisig payment. Calls `sign_multisig_payment`.

```bash
lumenflow multisig sign \
  --payment-id "MS_001" \
  --signer    GSIGNER1... \
  --signature <hex-encoded-ed25519-signature>
```

| Flag            | Description                                     |
|-----------------|-------------------------------------------------|
| `--payment-id`  | Payment ID to sign                              |
| `--signer`      | Your address (must be in the signers list)      |
| `--signature`   | Ed25519 signature bytes, hex-encoded            |

---

### multisig execute

Execute a multisig payment once the required signature threshold is met.
Calls `execute_multisig_payment`.

```bash
lumenflow multisig execute \
  --payment-id "MS_001" \
  --payer     GPAYER...
```

| Flag           | Description                              |
|----------------|------------------------------------------|
| `--payment-id` | Payment ID to execute                    |
| `--payer`      | Address funding the token transfer       |

---

### multisig status

Fetch and display a status summary for a multisig payment.
Calls `get_multisig_payment`.

```bash
lumenflow multisig status --payment-id "MS_001"
```

**Sample output**
```
--- Status Summary ---
  Payment ID:           MS_001
  Merchant:             GMERCHANT...
  Token:                CTOKEN...
  Amount:               5000
  Required Signatures:  2
  Signatures Collected: 1 / 2
  Executed:             false
  Created At:           1720000000
```

---

### multisig cancel

Cancel a pending (not yet executed) multisig payment.
Calls `cancel_multisig_payment`. Only the initiator (a listed signer) or the admin can cancel.

```bash
lumenflow multisig cancel \
  --payment-id "MS_001" \
  --caller    GSIGNER1...
```

| Flag           | Description                                        |
|----------------|----------------------------------------------------|
| `--payment-id` | Payment ID to cancel                               |
| `--caller`     | Your address (must be a signer or the admin)       |

---

## Full Workflow Example

```bash
# 1. Set config
export LUMENFLOW_NETWORK=testnet
export LUMENFLOW_CONTRACT_ID=CXXXXXXXXXXXXXXX
export LUMENFLOW_SOURCE=SXXXXXXXXXXXXXXX

# 2. Initiate
lumenflow multisig init \
  --payment-id "MS_INVOICE_42" \
  --merchant  GMERCHANT... \
  --token     CTOKEN... \
  --amount    10000 \
  --signers   "GSIG1...,GSIG2...,GSIG3..." \
  --required  2

# 3. Each signer signs
lumenflow multisig sign \
  --payment-id "MS_INVOICE_42" \
  --signer    GSIG1... \
  --signature <sig1-hex>

lumenflow multisig sign \
  --payment-id "MS_INVOICE_42" \
  --signer    GSIG2... \
  --signature <sig2-hex>

# 4. Check status
lumenflow multisig status --payment-id "MS_INVOICE_42"

# 5. Execute once threshold is met
lumenflow multisig execute \
  --payment-id "MS_INVOICE_42" \
  --payer     GPAYER...
```
