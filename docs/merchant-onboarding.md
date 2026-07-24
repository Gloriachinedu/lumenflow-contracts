# Merchant Onboarding Guide

This guide walks new merchants through the LumenFlow registration process using the onboarding wizard at [`frontend/onboarding.html`](../frontend/onboarding.html).

---

## Overview

The onboarding wizard is a 5-step flow that guides merchants from wallet connection through contract registration. No backend or build step is required — it runs entirely in the browser.

---

## Step-by-Step Walkthrough

### Step 1 — Welcome

Introduces LumenFlow and its core benefits:

- **Instant Settlement** — payments settle in seconds on Stellar
- **Low Fees** — minimal 2.5% platform fee, no hidden charges
- **Multi-sig Security** — optional multi-party approval for high-value payments

Click **Get Started** to proceed.

---

### Step 2 — Connect Wallet

Your Stellar wallet address becomes your merchant identity on-chain.

| Option | Description |
|--------|-------------|
| **Freighter** | Browser extension wallet. Install from [freighter.app](https://www.freighter.app/) |
| **Albedo** | Web-based wallet. Available at [albedo.link](https://albedo.link/) |
| **Demo mode** | Simulates a wallet address for UI preview without a real wallet |

Once connected, your public address is displayed and used for all subsequent steps.

---

### Step 3 — Business Details

Required information fields:

| Field | Description | Max Length |
|-------|-------------|------------|
| **Business Name** | Display name shown to customers | 80 characters |
| **Description** | Brief description of your products/services | 280 characters |
| **Contact Email** | Support or billing email | — |
| **Category** | Retail / Services / Digital / Food & Beverage / Other | — |

All fields are validated client-side before proceeding. Error messages appear inline if any field is invalid.

---

### Step 4 — Review & Register

Displays a read-only summary of all entered details before submission. Also shows:

- **Platform fee**: 2.5% per transaction
- **Refund window**: 30 days from payment date
- **Minimum refund amount**: 100 stroops

Click **Register Merchant** to submit. In demo mode, a 2-second simulated delay mimics network confirmation. In live mode, this calls the `register_merchant` contract function via the connected wallet.

---

### Step 5 — Done

Confirms successful registration and provides next steps:

- Share your [payment receipt link](../frontend/receipt.html) with customers
- Browse your [payment history](../frontend/history.html)
- Manage refunds from the [merchant dashboard](../dashboard/merchant-dashboard/index.html)

---

## Expected Next Steps After Registration

1. **Configure your payment token** — add allowed tokens via `add_allowed_token` (admin).
2. **Test a payment** — use the CLI or history page to process a test payment.
3. **Set up webhook notifications** — follow the [webhook integration guide](webhook-integration.md).
4. **Monitor activity** — use the [fraud analytics dashboard](../dashboard/fraud-analytics/index.html) to review suspicious activity.

---

## Troubleshooting

**Wallet not connecting:**
- Ensure Freighter is installed and the extension is unlocked.
- Check that your browser allows extensions on the page origin.

**Already registered error:**
- The wizard detects existing profiles via `is_registered`. If you see this, your address is already on-chain — proceed to the dashboard.

**Transaction pending for too long:**
- Stellar transactions typically confirm in 5 seconds. If pending longer, check network status at [status.stellar.org](https://status.stellar.org).

**Validation errors:**
- All fields on Step 3 are required. Ensure the email is in `user@domain.tld` format.

---

## Related Resources

- [Contract API — Merchant Management](../README.md#merchant-management)
- [CLI Usage](../README.md#cli-usage)
- [Developer Onboarding Guide](ONBOARDING.md)
