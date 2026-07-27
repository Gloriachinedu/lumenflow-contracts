# User Journeys

This document describes key user journeys for LumenFlow merchants and administrators.

---

## 1. Tag-Based Analytics and Filtering

### Overview

Merchants can attach optional tags to payments (e.g., `campaign:summer-sale`, `product:widget-a`, `channel:referral`). The payment history page and dashboard provide tag-based filtering and revenue breakdowns so merchants can analyse performance by product category or campaign.

### Prerequisites

- Merchant wallet connected (Freighter or Albedo)
- One or more payments recorded with tags set via `process_payment_with_signature` using the `tags` field

### Journey: Filtering payment history by tag

1. **Open Payment History** – Navigate to `frontend/history.html`.
2. **Enter merchant address** – Type or paste your Stellar address in the *Merchant Address* field.
3. **Select a tag from the autocomplete** – Click the *Tag* filter field. As you type, the autocomplete dropdown displays tags found in your recent payments (e.g., `summer-sale`, `product:widget-a`). Select a tag from the list or type a custom value.
4. **Combine with other filters** *(optional)* – Add a date range, amount range, or status filter alongside the tag filter. All filters are combined (AND logic).
5. **View filtered results** – The history table updates to show only payments that include the selected tag. An active-filter chip appears above the table showing `Tag: <value>`. Click **×** on the chip to clear the tag filter.
6. **Export or paginate** – Use the pagination controls to browse additional pages of filtered results.

### Journey: Viewing tag revenue breakdown on the dashboard

1. **Open Payment History page** – Navigate to `frontend/history.html` (tag analytics panel is embedded in the page).
2. **Load payment history** – Enter your merchant address and optionally set a date range.
3. **View tag breakdown panel** – Below the filter panel, the *Revenue by Tag (Top 5)* panel displays a bar chart showing total volume (in XLM) for each of the top 5 tags found in the returned payments.
4. **Interpret results** – Each bar is labelled with the tag name and total XLM volume. Payments with no tags are grouped under `(untagged)`.
5. **Drill down** – Click a bar or tag label to apply that tag as a filter, immediately re-running the history query with `Tag: <value>` active.

### Acceptance criteria reference

| Criterion | Where implemented |
|---|---|
| Tag filter field in payment history filter panel | `frontend/history.html` – Tag filter group |
| Filtering by tag calls `get_merchant_payment_history` | `frontend/history.html` – `buildFilterArg()` passes `tag` field |
| Dashboard shows top-5 tag volume breakdown | `frontend/history.html` – `renderTagBreakdown()` |
| Tag autocomplete dropdown from recent payments | `frontend/history.html` – `populateTagAutocomplete()` |
| Tag filter combinable with date range and status | `frontend/history.html` – `filters` object, `buildFilterArg()` |
| This document updated | `docs/user-journeys.md` |

---

## 2. Submitting a Payment

### Overview

A payer submits a signed payment to a registered merchant.

### Journey

1. **Obtain merchant address** – Get the merchant's Stellar address.
2. **Build signature payload** – Follow the format described in `docs/signature-format.md`.
3. **Sign the payload** – Use the SDK (`signPaymentPayload`) or sign manually with your ed25519 key.
4. **Call `process_payment_with_signature`** – Include `order_id`, `merchant_address`, `token_address`, `amount`, `memo`, optional `tags`, `signature`, and `merchant_public_key`.
5. **Receive confirmation** – The contract emits a `lumenflow/payment_processed` event. The payer's UI shows a success notification (see `docs/monitoring.md` for SSE subscription details).

---

## 3. Initiating and Completing a Refund

### Overview

A payer or merchant can initiate a refund within 30 days of a payment.

### Journey

1. **Initiate** – Call `initiate_refund` with `refund_id`, `order_id`, `amount`, and `reason`.
2. **Merchant reviews** – The merchant sees the pending refund in their dashboard (`dashboard/merchant-dashboard/`).
3. **Approve or reject** – Merchant calls `approve_refund` or `reject_refund`.
4. **Execute** – After approval, the merchant calls `execute_refund`, signing the token transfer.
5. **Confirmation** – The `lumenflow/refund_executed` event fires; the payer is notified.

---

## 4. Multi-Signature Payment Flow

### Overview

High-value payments can require multiple signers before funds are released.

### Journey

1. **Initiate** – Call `initiate_multisig_payment` specifying `signers` and `required_signatures`.
2. **Co-signers approve** – Each listed signer calls `sign_multisig_payment` with their ed25519 signature.
3. **Threshold met** – Once `required_signatures` signatures are collected, call `execute_multisig_payment` to release funds.
4. **Expiry** – If the threshold is not met within the configured expiry window, the payment can be cancelled by the initiator or admin.

For a detailed guide, see `docs/multisig-guide.md`.

---

## 5. Admin: Pausing and Unpausing the Contract

### Journey

1. **Open Admin Dashboard** – Navigate to `dashboard/admin/index.html`.
2. **Authenticate** – Connect your admin wallet (Freighter). The page verifies on-chain admin status.
3. **Pause** – Click *Pause Contract* and confirm in the wallet. The contract rejects all new payments while paused.
4. **Unpause** – Click *Unpause Contract* and confirm in the wallet to resume normal operations.
