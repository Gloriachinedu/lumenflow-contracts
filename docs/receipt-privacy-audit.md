# Receipt Page Privacy Audit

**Issue:** [#354](https://github.com/Gloriachinedu/lumenflow-contracts/issues/354)  
**Status:** Completed  
**Scope:** `frontend/receipt.html`, `frontend/receipt.js`

---

## Overview

The receipt page (`receipt.html` / `receipt.js`) is a publicly shareable page that
allows anyone with an order ID to view payment confirmation details. Because the URL
is designed to be forwarded to third parties (e.g., emailed receipts, shared links),
only non-sensitive, business-relevant fields must be exposed.

---

## Data Exposure Audit

### Fields rendered on the receipt page

| Field | Source | Rendered? | Sensitivity | Notes |
|---|---|---|---|---|
| `order_id` | `get_payment_summary` | ✅ Yes | Public | Customer-facing identifier, safe to display |
| `merchant_address` | `get_merchant` | ✅ Yes (name only) | Low | Only merchant display name is shown, not the raw address |
| `merchant.verified` | `get_merchant` | ✅ Yes (badge) | Public | Boolean flag, safe |
| `amount` | `get_payment_summary` | ✅ Yes | Public | Core receipt data |
| `token` / asset | `get_payment_summary` | ✅ Yes | Public | Asset contract address; safe — no secret material |
| `paid_at` | `get_payment_summary` | ✅ Yes | Public | Timestamp, safe |
| `status` | `get_payment_summary` | ✅ Yes | Public | Completed / PartiallyRefunded / FullyRefunded |
| `memo` | `get_payment_summary` | ❌ No | Low | Omitted; memos may contain internal notes |
| `payer` address | `get_payment_by_id` | ❌ No | **Sensitive** | Full payer Stellar address — NOT rendered |
| `refunded_amount` raw | internal | ❌ No | Low | Net refund shown via refund history, not raw field |
| Refund `reason` text | refund records | ✅ Yes | Low | Visible to both parties; no secret data expected |
| Refund `refund_id` | refund records | ✅ Yes | Public | Reference ID, safe |

### Fields present in demo data but not rendered

The demo data in `receipt.js` includes a `payer` field
(`GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN`) solely to match the
shape of a real contract response. The `renderReceipt()` function does **not** read
or display `payment.payer` at any point.

---

## Privacy Considerations

### 1. Payer address is never displayed

The payer's Stellar address is a personally identifiable on-chain identifier. It
must not appear on the public receipt page, as the receipt URL is intended to be
forwarded to merchants, auditors, or support staff who have no business need to see
the payer's full wallet address.

**Enforcement:** `renderReceipt()` in `receipt.js` only reads
`payment.order_id`, `payment.amount`, `payment.token`, `payment.status`, and
`payment.paid_at`. The `payment.payer` field is destructured from the response
object but is **never passed to any DOM setter**.

### 2. `get_payment_summary` is the preferred data source

The contract exposes two payment read functions:

- `get_payment_summary` — public endpoint returning a minimal, non-sensitive summary
  (`order_id`, `merchant_address`, `amount`, `status`, `paid_at`, `token`).
- `get_payment_by_id` — authenticated endpoint returning full payment details
  including `payer`, `memo`, `tags`, and signature metadata.

The receipt page **should prefer `get_payment_summary`** for public-facing receipt
lookups. The current implementation calls `get_payment_by_id` with a static
placeholder caller address; a follow-up hardening task should migrate to
`get_payment_summary` to avoid unnecessarily fetching sensitive fields.

> See [Recommended Hardening](#recommended-hardening) below.

### 3. Fallback / not-found state is safe

When no payment record is found for a given order ID, the page displays:

- A "Receipt not found" message
- The order ID that was searched (echoed from the URL parameter)
- Suggested next steps (check email, contact support)

The not-found state does **not** leak any contract error details, stack traces,
or distinguish between "payment does not exist" and "payment exists but caller
is unauthorized." This is the correct behaviour to prevent enumeration attacks.

### 4. Order ID echoing (XSS consideration)

The order ID from the URL is displayed in the not-found state via:

```js
document.getElementById('missing-id').textContent = orderId;
```

Using `.textContent` (not `.innerHTML`) ensures the value is HTML-escaped and
cannot be used for cross-site scripting via a crafted URL.

### 5. Receipt URL shareability

Receipt URLs take the form:

```
/receipt.html?orderId=ORDER_001
/receipt/ORDER_001
```

These URLs contain only the order ID. No session tokens, wallet addresses, or
authentication material appear in the URL, making them safe to share via email
or messaging apps.

---

## Recommended Hardening

| Priority | Action |
|---|---|
| Medium | Migrate live-mode fetch from `get_payment_by_id` to `get_payment_summary` to avoid loading payer/memo/tags entirely |
| Medium | Add a Content Security Policy (`Content-Security-Policy` header or `<meta>` tag) to the receipt page |
| Low | Truncate or omit the `token` contract address for non-technical audiences (show asset code instead, e.g. "USDC") |
| Low | Add rate-limiting or CAPTCHA on the public receipt lookup to prevent order ID enumeration |
| Low | Audit `memo` field — if exposed via `get_payment_summary` in future, add an explicit omission in `renderReceipt()` |

---

## Summary

The receipt page correctly limits data exposure to non-sensitive payment metadata.
The payer address, raw memo, and internal tags are not rendered. The not-found
fallback is safe against enumeration and XSS. The primary hardening opportunity is
migrating the live-mode data fetch to `get_payment_summary` to enforce field-level
data minimisation at the API call layer.
