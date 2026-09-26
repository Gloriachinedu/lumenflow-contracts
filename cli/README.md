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

## Sensitive Parameter Handling

The `--source-account` flag accepts a Stellar secret key. Passing secrets as
CLI flags is discouraged because they appear in shell history. The CLI
provides safer alternatives.

### Priority order for the source account key

1. **`--key-file <FILE>`** — Read the key from a file. The file content is
   trimmed; the value is never echoed.
2. **`--prompt-key`** — Prompt interactively with hidden input (no echo),
   even if a key is already set.
3. **Auto-prompt (interactive terminal)** — When `--source-account` is
   omitted and no key is set via config/env, the CLI detects whether stdin
   is a TTY. If it is, the key is prompted with hidden input automatically.
4. **`LUMENFLOW_SOURCE` environment variable** — Set the key in the
   environment; never passes through shell history.
5. **`source_account` in `.lumenflow.toml`** — Lowest priority; suitable
   for local development only. Do not commit this file with real keys.

### Non-interactive (CI) mode

When stdin is **not** a TTY (e.g. a GitHub Actions runner, a Docker
container, or a pipe), the CLI will **not** attempt an interactive prompt.
Instead it returns a clear, actionable error:

```
Missing source account secret key.
In non-interactive (CI) environments, provide the key explicitly:

Option 1 — environment variable:
  LUMENFLOW_SOURCE=<secret-key> lumenflow ...

Option 2 — flag (not recommended; appears in shell history):
  lumenflow --source-account <secret-key> ...

Option 3 — key file (recommended for CI):
  lumenflow --key-file /path/to/keyfile ...
```

### Recommended CI setup

```yaml
# GitHub Actions example
- name: Run lumenflow command
  env:
    LUMENFLOW_SOURCE: ${{ secrets.LUMENFLOW_SOURCE_ACCOUNT }}
    LUMENFLOW_CONTRACT_ID: ${{ secrets.CONTRACT_ID }}
  run: lumenflow stats --admin $ADMIN_ADDRESS
```

Using `LUMENFLOW_SOURCE` ensures the secret is injected from the CI
secrets store and never appears in logs or shell history.

### Security guarantees

- Sensitive values entered via hidden prompt are **never** written to
  stdout, stderr, log files, or the CI step summary.
- The `print-config` command redacts the source account:
  `SABC…WXYZ` (first 4 + last 4 chars only).
- The `--source-account` CLI flag should only be used for quick local
  testing. In any shared or automated environment, prefer
  `LUMENFLOW_SOURCE` or `--key-file`.

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

### `refund approve` — Approve a pending refund (merchant or admin)

```bash
lumenflow refund approve --refund-id REFUND_001 --caller <merchant-address>
```

---

### `refund reject` — Reject a pending refund (merchant or admin)

```bash
lumenflow refund reject --refund-id REFUND_001 --caller <merchant-address>
```

---

### `refund execute` — Execute an approved refund (merchant)

```bash
lumenflow refund execute --refund-id REFUND_001
```

---

### `refund status` — Get the status of a single refund

```bash
lumenflow refund status --refund-id REFUND_001
```

---

### `refund list` — List all refunds for an order

Lists all refunds associated with a given order. The caller must be the
payer, merchant, or admin authorised on the contract.

```bash
lumenflow refund list --order-id ORDER_001 --caller <caller-address>
```

**Output (default — table format):**

```
+------------+-----------+--------+------------------+-----------------------------------------+
| refund_id  | status    | amount | reason           | initiator                               |
+------------+-----------+--------+------------------+-----------------------------------------+
| REFUND_001 | Approved  | 500    | Customer request | GPAYER...                               |
| REFUND_002 | Completed | 250    | Damaged item     | GMERCHANT...                            |
+------------+-----------+--------+------------------+-----------------------------------------+
2 refund(s) for order ORDER_001.
```

**JSON output** (pipe-friendly, for scripting):

```bash
lumenflow refund list --order-id ORDER_001 --caller <caller-address> --output json
```

| Flag          | Short | Required | Description                                         |
|---------------|-------|----------|-----------------------------------------------------|
| `--order-id`  | `-o`  | Yes      | Order ID to list refunds for                        |
| `--caller`    |       | Yes      | Caller address (payer, merchant, or admin)          |
| `--output`    |       | No       | Output format: `table` (default) or `json`          |

The output includes: `refund_id`, `status`, `amount`, `reason`, `initiator`.

---

### `history` — View payment history

```bash
lumenflow history --merchant GBUYUAI75XXWDZEKLY66CFYKQPET5JR4EAPL7STQKQCRLKJ74SC65VU
```

---

### `merchant list` — List registered merchants (admin only)

Lists all registered merchants with cursor-based pagination. Requires an admin key.

```bash
lumenflow merchant list --admin-key $ADMIN_KEY
```

With pagination and JSON output:

```bash
lumenflow merchant list \
  --admin-key $ADMIN_KEY \
  --limit 25 \
  --cursor GLAST_MERCHANT_ADDRESS \
  --output json
```

| Flag          | Env var               | Required | Description                                          |
|---------------|-----------------------|----------|------------------------------------------------------|
| `--admin-key` | `LUMENFLOW_ADMIN_KEY` | Yes      | Admin secret key or address                          |
| `--limit`     |                       | No       | Max merchants per page (default: 10)                 |
| `--cursor`    |                       | No       | Pagination cursor (address from previous page)       |
| `--output`    |                       | No       | Output format: `text` (default) or `json`            |

Output fields per merchant: `address`, `name`, `category`, `is_verified`, `is_active`.

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
