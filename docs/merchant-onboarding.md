# Merchant Onboarding Guide

This guide walks you through everything you need to start accepting payments with LumenFlow on the Stellar network.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step 1: Connect Your Wallet](#step-1-connect-your-wallet)
3. [Step 2: Fund Your Account](#step-2-fund-your-account)
4. [Step 3: Check Existing Registration](#step-3-check-existing-registration)
5. [Step 4: Register as a Merchant](#step-4-register-as-a-merchant)
6. [Step 5: Optional — Get Verified](#step-5-optional--get-verified)
7. [Step 6: Accept Your First Payment](#step-6-accept-your-first-payment)
8. [Managing Your Profile](#managing-your-profile)
9. [Payment History and Statistics](#payment-history-and-statistics)
10. [Refunds](#refunds)
11. [Data Deletion](#data-deletion)
12. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Before you begin, ensure you have:

- A **Stellar wallet** (e.g., [Freighter](https://www.freighter.app/), Lobstr, or a hardware wallet)
- Sufficient **XLM** to cover transaction fees (at least 1 XLM recommended)
- The **LumenFlow contract ID** for the network you wish to use (testnet or mainnet)
- The **Stellar CLI** installed if you are interacting directly with the contract:

  ```bash
  stellar --version
  ```

---

## Step 1: Connect Your Wallet

LumenFlow uses your Stellar public key as your merchant identifier. There is no separate username or password.

**Using the dashboard:** Open the [merchant dashboard](../dashboard/merchant-dashboard/index.html) in your browser and connect via the Freighter browser extension.

**Using the CLI:** Export your account secret key to an environment variable:

```bash
export MERCHANT_KEY="S..."         # your secret key
export MERCHANT_ADDR="G..."        # your public key
export CONTRACT_ID="C..."          # LumenFlow contract ID
export NETWORK="testnet"           # or "mainnet"
```

> **Security:** Never share your secret key. LumenFlow never asks for it; only the Stellar CLI or Freighter use it locally to sign transactions.

---

## Step 2: Fund Your Account

On **testnet**, fund your account with the Stellar Friendbot:

```bash
curl "https://friendbot.stellar.org?addr=$MERCHANT_ADDR"
```

On **mainnet**, acquire XLM from a supported exchange and transfer it to your wallet address.

---

## Step 3: Check Existing Registration

Verify that your address is not already registered:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $MERCHANT_KEY \
  --network $NETWORK \
  -- is_registered \
  --merchant_address $MERCHANT_ADDR
```

If the result is `true`, you are already registered. Skip to [Managing Your Profile](#managing-your-profile).

---

## Step 4: Register as a Merchant

Register your business by providing your display name, description, contact info, and category:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $MERCHANT_KEY \
  --network $NETWORK \
  -- register_merchant \
  --merchant_address $MERCHANT_ADDR \
  --name "My Store" \
  --description "Short description of your business" \
  --contact_info "support@mystore.example.com" \
  --category Retail
```

Available categories: `Retail`, `Food`, `Services`, `Digital`, `Other`, or `Custom(<string>)`.

On success, a `lumenflow/merchant_registered` event is emitted and your profile is active.

---

## Step 5: Optional — Get Verified

Merchant verification is performed by a LumenFlow admin. Verified merchants appear with a verification badge in supporting front-end applications.

To request verification, contact the platform administrator (see `README.md` for community links). Once verified, the `verified` flag on your profile will be set to `true`.

---

## Step 6: Accept Your First Payment

To accept a payment, the payer calls `process_payment_with_signature` with:

- Your `merchant_address`
- An allowed `token_address`
- A valid `order_id`
- An amount
- Your **ed25519 signature** over the payment payload (to prevent spoofed payments)

Refer to [docs/signature-format.md](signature-format.md) for the exact payload format and code examples in JavaScript, Python, and Rust.

---

## Managing Your Profile

### View your profile

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $MERCHANT_KEY \
  --network $NETWORK \
  -- get_merchant \
  --merchant_address $MERCHANT_ADDR
```

### Update your profile

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $MERCHANT_KEY \
  --network $NETWORK \
  -- update_merchant \
  --merchant_address $MERCHANT_ADDR \
  --name "My Store Updated" \
  --description "Updated description" \
  --contact_info "new-contact@mystore.example.com" \
  --category Services
```

> Only active merchants can update their profile. If your account has been deactivated, contact a platform admin.

---

## Payment History and Statistics

### View payment history (paginated)

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $MERCHANT_KEY \
  --network $NETWORK \
  -- get_merchant_payment_history \
  --merchant $MERCHANT_ADDR \
  --cursor null \
  --limit 20 \
  --filter null \
  --sort_field Date \
  --sort_order Descending
```

Pass the returned `next_cursor` to retrieve the next page.

### View your stats

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $MERCHANT_KEY \
  --network $NETWORK \
  -- get_merchant_stats \
  --merchant $MERCHANT_ADDR
```

---

## Refunds

Refunds must be initiated within the configured refund window (default: 30 days) of the original payment.

### Initiate a refund

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source-account $MERCHANT_KEY \
  --network $NETWORK \
  -- initiate_refund \
  --caller $MERCHANT_ADDR \
  --refund_id "REFUND_001" \
  --order_id "ORDER_001" \
  --amount 500 \
  --reason "Customer request"
```

### Approve and execute a refund

```bash
# Approve
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY \
  --network $NETWORK -- approve_refund \
  --caller $MERCHANT_ADDR --refund_id "REFUND_001"

# Execute (merchant signs the token transfer)
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY \
  --network $NETWORK -- execute_refund --refund_id "REFUND_001"
```

See [docs/refund-lifecycle.md](refund-lifecycle.md) for the full state diagram.

---

## Data Deletion

LumenFlow supports the **GDPR right to erasure** (right to be forgotten) for merchant profiles. You can request deletion of the personal data fields stored in your on-chain merchant profile at any time.

### What gets deleted

When a deletion request is confirmed, the following fields in your profile are replaced with the placeholder value `[deleted]`:

- `name` → `[deleted]`
- `description` → `[deleted]`
- `contact_info` → `[deleted]`

Your Stellar public key (`address`) is retained as a pseudonymous reference so that existing payment records remain internally consistent. Payment amounts and timestamps are also retained for financial record-keeping.

### Limitations

Because the Stellar blockchain is immutable:

- **On-chain event logs** and **transaction records** emitted before the deletion request are permanently recorded and cannot be removed.
- **Off-chain copies** held by third-party applications or analytics systems are outside LumenFlow's control.

### How to request deletion

1. **Submit the deletion request on-chain** by calling `request_merchant_data_deletion`:

   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID \
     --source-account $MERCHANT_KEY \
     --network $NETWORK \
     -- request_merchant_data_deletion \
     --merchant $MERCHANT_ADDR
   ```

   This call requires your signature (only you can request deletion of your own profile).

2. **Admin confirmation:** A LumenFlow admin must confirm and action the request within **30 days**. The admin will call the function with the required confirmation, which triggers the anonymisation of your PII fields.

3. **Confirmation event:** On completion, a `lumenflow/merchant_data_deleted` event is emitted on-chain. You can verify deletion by calling:

   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID \
     --source-account $MERCHANT_KEY \
     --network $NETWORK \
     -- get_merchant \
     --merchant_address $MERCHANT_ADDR
   ```

   The `name`, `description`, and `contact_info` fields will all read `[deleted]`.

4. **Off-chain deletion:** If you also need data removed from off-chain systems, contact **privacy@lumenflow.example.com** with your public key and a description of the systems involved.

### Full privacy policy

For full details on what data is stored, your rights under GDPR, data retention periods, and how to contact the data controller, see [PRIVACY.md](../PRIVACY.md).

---

## Troubleshooting

| Problem | Possible cause | Resolution |
|---------|---------------|------------|
| `MerchantAlreadyRegistered` | Address already has a profile | Use `get_merchant` to retrieve your existing profile |
| `MerchantInactive` | Your account has been deactivated | Contact a platform admin to reactivate |
| `Unauthorized` | Signature mismatch or wrong caller | Ensure you are signing with the merchant key matching `merchant_address` |
| `InvalidInput` | Empty `name` field | Provide a non-empty merchant name |
| `TokenNotAllowed` | Token not on the whitelist | Use an approved token; check with the platform admin |
| `ContractPaused` | Contract is paused | Wait for the admin to unpause; check status announcements |

For further support:

- **Discord:** https://discord.gg/lumenflow
- **GitHub Discussions:** https://github.com/Gloriachinedu/lumenflow-contracts/discussions
- **Support guidelines:** [SUPPORT.md](../SUPPORT.md)
