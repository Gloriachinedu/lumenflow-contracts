# Runbook: Platform Fee Configuration

**Audience:** Contract operators and platform administrators  
**Contract:** LumenFlow (Soroban / Stellar)  
**Related admin functions:** `set_platform_fee_bps`, `set_fee_recipient`

---

## Overview

LumenFlow supports an optional platform fee that is deducted from each processed payment before the merchant receives funds. The fee is expressed in **basis points (bps)** — 1 bps = 0.01%, so 100 bps = 1%.

When a fee is configured, the flow for a payment of amount `A` is:

```
fee_amount  = A × fee_bps / 10_000   (rounded down to the nearest stroop)
net_amount  = A − fee_amount

token.transfer(payer  → fee_recipient, fee_amount)
token.transfer(payer  → merchant,      net_amount)
```

If `fee_bps` is `0` (default), the fee transfer step is skipped entirely and the merchant receives the full amount.

---

## Prerequisites

- Stellar CLI installed (`stellar --version`)
- Admin secret key available and funded
- `CONTRACT_ID` and `NETWORK` environment variables set

```bash
export CONTRACT_ID=<your-contract-id>
export NETWORK=testnet          # or mainnet
export ADMIN_KEY=<admin-secret-key>
export ADMIN_ADDR=<admin-address>
export FEE_RECIPIENT=<fee-recipient-address>
```

---

## Operations

### 1. Set the platform fee (basis points)

Set the fee to 50 bps (0.5%):

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- set_platform_fee_bps \
  --admin "$ADMIN_ADDR" \
  --fee_bps 50
```

**Valid range:** `0` – `10000` (0% – 100%).  
**Recommended maximum for production:** ≤ 500 bps (5%).

To remove the platform fee entirely, set it back to `0`:

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- set_platform_fee_bps \
  --admin "$ADMIN_ADDR" \
  --fee_bps 0
```

---

### 2. Set the fee recipient

The fee recipient is the Stellar address that will receive the fee portion of every payment. It must be set **before** or **at the same time as** enabling a non-zero fee.

```bash
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source-account "$ADMIN_KEY" \
  --network "$NETWORK" \
  -- set_fee_recipient \
  --admin "$ADMIN_ADDR" \
  --recipient "$FEE_RECIPIENT"
```

> **Note:** The fee recipient account must exist on-chain and have a trustline for the payment token. If the token is a SAC (Stellar Asset Contract), a trustline is created automatically.

---

### 3. Verify fee deduction from a payment

After configuration, verify that fees are deducted correctly by inspecting a test payment on Horizon:

```bash
# Inspect the most recent payment transaction for the fee recipient
stellar transactions \
  --account "$FEE_RECIPIENT" \
  --network "$NETWORK" \
  --limit 5
```

Alternatively, query the Horizon HTTP API directly:

```bash
curl "https://horizon-testnet.stellar.org/accounts/$FEE_RECIPIENT/payments?order=desc&limit=5"
```

For each `lumenflow/payment_processed` event, the emitted event payload includes:
- `amount` — gross payment amount
- `fee_amount` — fee deducted (0 if no fee configured)
- `net_amount` — amount received by the merchant

Cross-check: `amount − fee_amount = net_amount`.

---

## Edge Case: `fee_recipient` not set when `fee_bps > 0`

If `fee_bps` is greater than `0` but `fee_recipient` has not been set, the contract will **reject the payment** with an error to prevent fees from being silently lost.

**Resolution steps:**

1. Confirm the current fee configuration:

   ```bash
   # No direct read function; check the last set_platform_fee_bps transaction
   # or query the storage key via Horizon:
   stellar contract read \
     --id "$CONTRACT_ID" \
     --network "$NETWORK" \
     --key FEE_BPS
   ```

2. Set the fee recipient before processing any payments:

   ```bash
   stellar contract invoke \
     --id "$CONTRACT_ID" \
     --source-account "$ADMIN_KEY" \
     --network "$NETWORK" \
     -- set_fee_recipient \
     --admin "$ADMIN_ADDR" \
     --recipient "$FEE_RECIPIENT"
   ```

3. Alternatively, disable the fee until a recipient is ready:

   ```bash
   stellar contract invoke \
     --id "$CONTRACT_ID" \
     --source-account "$ADMIN_KEY" \
     --network "$NETWORK" \
     -- set_platform_fee_bps \
     --admin "$ADMIN_ADDR" \
     --fee_bps 0
   ```

---

## Quick-Reference Summary

| Goal | Command |
|------|---------|
| Enable fee (e.g. 50 bps) | `set_platform_fee_bps --fee_bps 50` |
| Disable fee | `set_platform_fee_bps --fee_bps 0` |
| Set fee recipient | `set_fee_recipient --recipient <address>` |
| Verify fee transfers | Query Horizon payments for `$FEE_RECIPIENT` |

---

## Related Documentation

- [Deployment Guide](../deployment-guide.md)
- [Monitoring Guide](../monitoring.md)
- [Events Reference](../events-reference.md)
- [Error Codes](../errors.md)
