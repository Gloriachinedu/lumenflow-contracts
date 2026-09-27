# Payment Link Generator — Guide

Merchants can generate shareable payment links that pre-fill the payer's payment form with the order details. This removes the need to manually share contract call parameters.

---

## Overview

A payment link is a URL that encodes the following parameters:

| Parameter   | Description                              | Required |
|-------------|------------------------------------------|----------|
| `merchant`  | Your Stellar merchant address (`G…`)     | Yes      |
| `token`     | Token / asset address                    | Yes      |
| `amount`    | Amount in stroops (1 XLM = 10,000,000)  | Yes      |
| `order_id`  | Unique order identifier                  | Yes      |
| `memo`      | Optional payment note                    | No       |
| `expires`   | Expiry timestamp (Unix ms, default 24 h) | Auto     |

When a payer opens the link, [`frontend/receipt.html`](../frontend/receipt.html) shows a pre-filled payment request with all the details and a **Pay with Freighter** button.

---

## Generating a link from the merchant dashboard

1. Open the [Merchant Dashboard](../dashboard/merchant-dashboard/index.html) in your browser.
2. Connect your wallet (Freighter or Albedo). Your merchant address is auto-filled into the form.
3. Fill in the **Generate Payment Link** form:
   - **Merchant Address** — auto-filled from your connected wallet.
   - **Token Address** — the Stellar asset address for the payment (e.g. a testnet SAC address).
   - **Amount (stroops)** — the amount to charge. 1 XLM = 10,000,000 stroops.
   - **Order ID** — a unique reference for this order (e.g. `ORDER_001`, `INV-2026-07`).
   - **Memo** *(optional)* — a note that appears on the payer's receipt.
   - **Link Expiry (hours)** — how long the link is valid. Default: 24 hours. Max: 8,760 (1 year).
4. Click **🔗 Generate Payment Link**.
5. The generated URL and a QR code appear below the form:
   - Copy the URL with **📋 Copy Link** to share via email, chat, or invoice.
   - Show or print the QR code for in-person or mobile payments.

---

## Sharing the link

Share the generated link or QR code via any channel:

- **Email / invoice** — paste the URL into your invoice template.
- **Messaging apps** — send the link directly to the payer.
- **In-person / mobile** — display the QR code for the payer to scan with their phone camera.
- **Embed in a web page** — link the URL from a "Pay Now" button on your website.

---

## Link expiry

Every link includes an `expires` timestamp. The default TTL is **24 hours** from the time of generation. You can set a custom TTL (1 hour to 8,760 hours / 1 year) in the dashboard form.

When a payer opens an expired link:
- The payment form is shown with an **⏱ Link Expired** badge.
- The **Pay** button is disabled.
- A note advises the payer to request a new link.

You can verify expiry programmatically using the exported `isLinkExpired(url)` helper in `dashboard/merchant-dashboard/app.js`:

```js
import { isLinkExpired } from './dashboard/merchant-dashboard/app.js';

const url = 'https://example.com/frontend/receipt.html?merchant=G...&expires=...';
if (isLinkExpired(url)) {
  console.log('This link has expired.');
}
```

---

## Generating a link programmatically

You can also build payment links in JavaScript using the exported `generatePaymentLink` helper:

```js
import { generatePaymentLink } from './dashboard/merchant-dashboard/app.js';

const url = generatePaymentLink({
  merchant:  'GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON',
  token:     'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVMIQVU2HHGCYSC',
  amount:    10_000_000, // 1 XLM in stroops
  orderId:   'ORDER_001',
  memo:      'Invoice #001',
  ttlHours:  24,
});

console.log(url);
// https://<your-host>/frontend/receipt.html?merchant=GBXG...&token=CDLZ...&amount=10000000&order_id=ORDER_001&memo=Invoice+%23001&expires=1753639200000
```

---

## URL structure

A generated payment link looks like this:

```
https://<your-host>/frontend/receipt.html
  ?merchant=GBXGQJWVLWOYHFLVTKWV5FGHA3LNYY2JQKM7OAJAUEQFU6LPCSEFVXON
  &token=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVMIQVU2HHGCYSC
  &amount=10000000
  &order_id=ORDER_001
  &memo=Invoice+%23001
  &expires=1753639200000
```

All parameter values are URL-encoded. The `expires` value is a Unix timestamp in **milliseconds**.

---

## QR code

The dashboard automatically generates a QR code alongside the URL using the [qrcode.js](https://github.com/davidshimjs/qrcodejs) library. The QR code encodes the full payment link URL and can be:

- **Displayed on screen** for mobile payers to scan.
- **Printed** on physical invoices or receipts.
- **Embedded in email** by taking a screenshot of the QR code element.

---

## Security considerations

- Payment links do not authorize a payment by themselves — the payer must still sign the Stellar transaction with their own wallet.
- The `expires` timestamp is checked client-side only. Do not rely on it for fraud prevention; always validate payment records on-chain.
- Order IDs must be unique per merchant. Re-using an order ID will cause `PaymentAlreadyExists` on the contract.
- Links encode payment details in the URL. Avoid including sensitive data in the `memo` field.

---

## Troubleshooting

| Issue | Cause | Resolution |
|-------|-------|------------|
| "Link Expired" shown to payer | TTL elapsed | Generate a new link with a longer TTL |
| QR code shows "QR library not loaded" | CDN blocked (offline/firewall) | Serve locally or use a self-hosted qrcode.js bundle |
| Pay button does nothing | Freighter not installed | Payer must install the [Freighter extension](https://www.freighter.app/) |
| `PaymentAlreadyExists` error | Order ID reused | Use a unique order ID for every new payment |
