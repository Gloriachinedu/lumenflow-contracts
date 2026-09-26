# lumenflow-cli

Command-line interface for the LumenFlow Soroban payment contract.

## Installation

```bash
cargo install --path cli/lumenflow-cli
```

## Configuration

The CLI reads config from `.lumenflow.toml` in the current directory, with environment variables taking precedence:

```toml
# .lumenflow.toml
network        = "testnet"   # testnet | mainnet | local
contract_id    = "C..."      # deployed contract address
source_account = "S..."      # signing secret key
```

| Environment variable   | Overrides         |
|------------------------|-------------------|
| `LUMENFLOW_NETWORK`    | `network`         |
| `LUMENFLOW_CONTRACT_ID`| `contract_id`     |
| `LUMENFLOW_SOURCE`     | `source_account`  |

A custom config path can be passed with `--config <FILE>`.

---

## Commands

### `pay` — Process a payment

#### Interactive mode (guided)

Run `lumenflow pay` with **no flags** to enter interactive mode.  
You will be prompted for each field one at a time, with real-time validation:

```
$ lumenflow pay

🌟  LumenFlow Interactive Payment — network: testnet
(Press Ctrl-C at any time to cancel)

? Merchant address (G…)  GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7STQKQCRLKJ74SC65VU
? Token  › XLM (native)
? Amount (in stroops, e.g. 10000000 = 1 XLM)  10000000
? Order ID (unique, no spaces)  ORDER_001
? Memo / reference (optional, press Enter to skip)  Invoice #001

┌──────────────────────────────────────────────────────────┐
│                   Payment Summary                        │
├──────────────────────────────────────────────────────────┤
│  Order:    ORDER_001                                     │
│  Merchant: GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7...    │
│  Amount:   10000000 stroops (1.0000000 XLM)              │
│  Token:    native                                        │
│  Memo:     Invoice #001                                  │
│  Network:  testnet                                       │
└──────────────────────────────────────────────────────────┘

? Submit this payment? (y/N)
```

**To exit interactive mode:** press `Ctrl-C` at any prompt, or answer `N` at the confirmation step.

**Validation rules applied in real time:**
- Merchant / token addresses: 56-character Stellar address starting with `G`
- Amount: positive integer (stroops)
- Order ID: non-empty, no whitespace

#### Non-interactive (flag-based) mode

All three required flags must be provided together.  
Flag-based mode is **fully backwards-compatible** — existing scripts are unaffected.

```bash
lumenflow pay \
  --merchant GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7STQKQCRLKJ74SC65VU \
  --amount 10000000 \
  --order-id ORDER_001 \
  --memo "Invoice #001" \
  --token native
```

| Flag          | Short | Required | Description                         |
|---------------|-------|----------|-------------------------------------|
| `--merchant`  | `-m`  | Yes      | Merchant Stellar address (G…)       |
| `--amount`    | `-a`  | Yes      | Amount in stroops (integer)         |
| `--order-id`  | `-o`  | Yes      | Unique order identifier             |
| `--memo`      |       | No       | Payment memo / reference            |
| `--token`     | `-t`  | No       | Token address (defaults to `native`)|

> Providing only some flags (but not all required ones) will print a helpful error
> directing you to either supply all flags or use interactive mode.

---

### `refund init` — Initiate a refund

```bash
lumenflow refund init --order-id ORDER_001 --amount 5000000
```

---

### `history` — View payment history

```bash
lumenflow history --merchant GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7STQKQCRLKJ74SC65VU
```

---

### `stats` — Global statistics (admin only)

```bash
lumenflow stats
```

---

## Help

```bash
lumenflow --help
lumenflow pay --help
```
