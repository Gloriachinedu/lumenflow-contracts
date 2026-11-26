# Merchant Payment Failures Troubleshooting Runbook

This runbook is a quick reference for merchants troubleshooting the most common payment failures. For each error code you will find the likely cause, the message your users may see, and the steps to resolve it.

For the full error code reference, see [docs/errors.md](../errors.md).

## Quick Reference

| Code | Name | Typical Cause |
|------|------|---------------|
| 1 | Unauthorized | Missing or invalid API credentials |
| 12 | MerchantInactive | Merchant account not active |
| 20 | PaymentNotFound | Unknown payment ID |
| 21 | PaymentAlreadyExists | Duplicate payment ID |
| 23 | InvalidSignature | Signature expired or malformed |
| 24 | PaymentExpired | Payment past its expiry window |
| 25 | InsufficientBalance | Payer or merchant balance too low |
| 26 | TokenNotAllowed | Token not permitted for this merchant |
| 32 | RefundWindowExpired | Refund attempted after the allowed window |
| 50 | InvalidInput | Malformed or missing request fields |

---

## 1 — Unauthorized

**Cause:** The request was made without valid API credentials, or the credentials do not match the merchant account. Common triggers include a missing `Authorization` header, a revoked API key, or using keys from a different environment (e.g. sandbox keys against production).

**User-facing message:** `Unauthorized`

**Resolution:**
1. Confirm the `Authorization` header is present on every request.
2. Verify you are using the correct API key for the target environment.
3. Check whether the key has been rotated or revoked in the merchant dashboard; if so, issue a new key.
4. Retry the request with valid credentials.

---

## 12 — MerchantInactive

**Cause:** The merchant account is not in an active state. This can happen during onboarding before activation, after a suspension, or when required compliance documents are missing.

**User-facing message:** `Merchant is not active`

**Resolution:**
1. Check the merchant status in the dashboard.
2. If onboarding is incomplete, finish the remaining verification steps.
3. If the account is suspended, review the suspension notice and contact support.
4. Once the account is active, retry the payment.

---

## 20 — PaymentNotFound

**Cause:** The payment ID referenced in the request does not exist. This is often caused by a typo, using an ID from a different environment, or querying before the payment was created.

**User-facing message:** `Payment not found`

**Resolution:**
1. Double-check the payment ID for typos.
2. Confirm the payment was created in the same environment you are querying.
3. Verify the create-payment call succeeded before fetching its status.
4. If the payment should exist, contact support with the request details.

---

## 21 — PaymentAlreadyExists

**Cause:** A payment with the same ID has already been created. This typically happens when a client retries a create request after a timeout without using an idempotency key.

**User-facing message:** `Payment already exists`

**Resolution:**
1. Fetch the existing payment by ID to confirm it was created.
2. Use idempotency keys on create requests to make retries safe.
3. Do not reuse payment IDs across distinct payments.

---

## 23 — InvalidSignature

**Cause:** The request signature is invalid, expired, or malformed. Common triggers include clock skew, signing the wrong payload, or reusing a signature past its validity window.

**User-facing message:** `Invalid signature`

**Resolution:**
1. Ensure your server clock is synchronized (NTP) to avoid timestamp skew.
2. Verify you are signing the exact request body and canonical parameters.
3. Generate a fresh signature for each request; do not cache signatures.
4. Confirm the signing secret matches the active API key.
5. Retry with a newly generated signature.

---

## 24 — PaymentExpired

**Cause:** The payment was not completed within its allowed expiry window.

**User-facing message:** `Payment has expired`

**Resolution:**
1. Create a new payment to obtain a fresh expiry window.
2. If users frequently hit expiry, consider extending the payment expiry setting where supported.
3. Prompt users to complete payment promptly after creation.

---

## 25 — InsufficientBalance

**Cause:** The payer does not have enough balance to cover the payment amount (including fees).

**User-facing message:** `Insufficient balance`

**Resolution:**
1. Confirm the payer's available balance covers the total amount.
2. Check whether fees are being applied that push the total above the balance.
3. Ask the payer to top up and retry.
4. For merchant-side failures, verify the merchant account has sufficient balance for the operation.

---

## 26 — TokenNotAllowed

**Cause:** The token (asset or currency) used for the payment is not permitted for this merchant. This can occur when the merchant has not enabled the token or when the token is restricted.

**User-facing message:** `Token not allowed`

**Resolution:**
1. Check which tokens are enabled for your merchant account.
2. Enable the required token in the dashboard if permitted.
3. If the token is restricted, use a supported token instead.
4. Contact support if you believe the token should be allowed.

---

## 32 — RefundWindowExpired

**Cause:** A refund was attempted after the allowed refund window for the payment has closed.

**User-facing message:** `Refund window has expired`

**Resolution:**
1. Check the payment's creation time against the refund window policy.
2. If a refund is still required, contact support to request a manual review.
3. Adjust your refund workflows to issue refunds within the window.

---

## 50 — InvalidInput

**Cause:** The request is malformed or missing required fields. This includes invalid amounts, unsupported field values, or missing required parameters.

**User-facing message:** `Invalid input`

**Resolution:**
1. Review the request against the API reference for required fields and formats.
2. Validate amounts, currency/token codes, and identifiers before sending.
3. Check the error details in the response for the specific field that failed validation.
4. Correct the request and retry.

---

## Still Stuck?

If none of the above resolves the issue:

1. Capture the full request and response, including the error code and any request ID.
2. Note the timestamp and environment (sandbox or production).
3. Contact support with these details.

For the complete list of error codes and their meanings, see [docs/errors.md](../errors.md).