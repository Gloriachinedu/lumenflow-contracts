# lumenflow-cli

Command-line interface for interacting with the LumenFlow smart contract on Stellar Soroban.

## Configuration

Create a `.lumenflow.toml` in your project root, or set environment variables:

```toml
network        = "testnet"          # or "mainnet" / "local"
contract_id    = "C..."             # deployed contract address
source_account = "S..."             # your secret key or account alias
```

| Environment variable          | Equivalent field      |
|-------------------------------|-----------------------|
| `LUMENFLOW_CONTRACT_ID`       | `contract_id`         |
| `LUMENFLOW_SOURCE`            | `source_account`      |
| `LUMENFLOW_NETWORK`           | `network`             |

---

## Refund Lifecycle

Refunds progress through the following states:

```
Initiated → Pending → Approved → Executed
                   ↘ Rejected
```

### 1. Initiate a refund

Either the payer or the merchant can open a refund request:

```bash
lumenflow refund init \
  --refund-id  REFUND_001 \
  --order-id   ORDER_001 \
  --amount     500 \
  --caller     <payer-or-merchant-address> \
  --reason     "Customer request"
```

### 2. Approve the refund

A merchant or admin approves the pending refund:

```bash
lumenflow refund approve \
  --refund-id REFUND_001 \
  --caller    <merchant-or-admin-address>
```

### 3. Reject the refund

A merchant or admin can reject instead:

```bash
lumenflow refund reject \
  --refund-id REFUND_001 \
  --caller    <merchant-or-admin-address>
```

### 4. Execute the refund

Once approved, the merchant executes the token transfer:

```bash
lumenflow refund execute --refund-id REFUND_001
```

### 5. Check status

Query the current state of any refund:

```bash
lumenflow refund status --refund-id REFUND_001
```

---

## Other Commands

```bash
# Process a payment
lumenflow pay --merchant <addr> --amount 1000 --order-id ORDER_001

# View payment history
lumenflow history --merchant <addr>

# View global stats (admin only)
lumenflow stats
```

---

## Building

```bash
cargo build -p lumenflow-cli --release
```

The binary is output to `target/release/lumenflow`.
