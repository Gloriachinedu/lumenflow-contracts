# LumenFlow Configuration Defaults

This document describes every admin-controlled configuration value, its compile-time default, the API to change it, and the business impact of that setting.

All defaults are defined as named constants in [`contracts/lumenflow/src/storage.rs`](../contracts/lumenflow/src/storage.rs).

---

## Platform Fee

| Property | Value |
|----------|-------|
| Constant | `DEFAULT_PLATFORM_FEE_BPS = 0` |
| Cap | `MAX_PLATFORM_FEE_BPS = 10_000` (= 100 %) |
| Unit | Basis points (1 bps = 0.01 %) |
| Storage key | `PlatformFeeBps` (instance) |
| Setter | `set_platform_fee(admin, fee_bps, fee_recipient)` |

**Default: 0 bps (no fee).** The contract does not collect any platform fee until an admin explicitly sets one.

**Business impact:** The fee is deducted from every payment processed via `process_payment_with_signature`. A value of `250` means 2.5 % is transferred to `fee_recipient` before the net amount reaches the merchant. Setting a fee above `10_000` is rejected with `InvalidInput` to prevent accidental configuration that would take more than 100 % of a payment.

**Recommended starting value:** `250` (2.5 %) for a typical marketplace; `0` for white-label deployments where the operator charges separately.

---

## Refund Window

| Property | Value |
|----------|-------|
| Constant | `DEFAULT_REFUND_WINDOW_SECS = 2_592_000` (30 days) |
| Floor | `MIN_REFUND_WINDOW_SECS = 3_600` (1 hour) |
| Unit | Seconds |
| Storage key | `RefundWindow` (instance) |
| Setter | `set_refund_window(admin, window_secs)` |

**Default: 30 days.** Customers can initiate a refund at any time within 30 days of payment.

**Business impact:** Shorter windows reduce merchant chargeback risk but decrease buyer confidence. Longer windows increase consumer protection. Values below 1 hour are rejected with `InvalidInput` because they would effectively prevent any refund from being initiated in practice.

**Recommended range:** 7–90 days depending on the merchant's industry and dispute resolution SLA.

---

## Large-Payment Threshold

| Property | Value |
|----------|-------|
| Constant | `DEFAULT_LARGE_PAYMENT_THRESHOLD = 10_000_000` (10 XLM in stroops) |
| Floor | Must be positive (enforced by `require_positive`) |
| Unit | Stroops (1 XLM = 10 000 000 stroops) |
| Storage key | `LargePaymentThreshold` (instance) |
| Setter | `set_large_payment_threshold(admin, threshold)` |

**Default: 10 000 000 stroops (10 XLM).** Any payment whose amount is ≥ this threshold causes a `lumenflow/suspicious_activity` event to be emitted with reason `LargePayment`.

**Business impact:** This is a monitoring trigger, not a block. Setting the threshold too low floods the event stream with false positives; setting it too high means genuinely unusual payments go unreported. Tune it to match the 99th-percentile transaction value for your merchant base.

**Recommended value:** Set to roughly 10–50× the median payment amount for your platform.

---

## Payment Cleanup Period

| Property | Value |
|----------|-------|
| Constant | `DEFAULT_CLEANUP_PERIOD_SECS = 2_592_000` (30 days) |
| Floor | Must be positive (enforced by `require_positive` in caller) |
| Unit | Seconds |
| Storage key | `CleanupPeriod` (instance) |
| Setter | `set_payment_cleanup_period(admin, period)` |

**Default: 30 days.** When `cleanup_expired_payments` runs, any payment record older than this value is eligible for removal.

**Business impact:** Shorter cleanup periods reduce on-chain storage costs but may delete records before dispute resolution windows close. The cleanup period should always be longer than the refund window to ensure payment records remain available during the refund lifecycle.

**Recommended value:** At least as long as `RefundWindow`, typically 30–90 days.

---

## Minimum Refund Amount

| Property | Value |
|----------|-------|
| Constant | `MIN_REFUND_AMOUNT = 100` (100 stroops) |
| Floor | Must be positive (enforced by `require_positive`) |
| Unit | Stroops |
| Storage key | `MinRefundAmount` (instance) |
| Setter | `set_min_refund_amount(admin, amount)` |

**Default: 100 stroops.** Refund requests below this amount are rejected with `RefundAmountTooSmall`.

**Business impact:** Prevents dust attacks and unnecessary on-chain operations for trivially small refunds. Should be set above the transaction fee cost to ensure refund execution is economically viable.

---

## Multisig Expiry Duration

| Property | Value |
|----------|-------|
| Constant | `DEFAULT_MULTISIG_EXPIRY = 604_800` (7 days) |
| Floor | Must be > 0 (enforced by `set_multisig_expiry_duration`) |
| Unit | Seconds |
| Storage key | `MultisigExpiryDuration` (instance) |
| Setter | `set_multisig_expiry_duration(admin, duration)` |

**Default: 7 days.** A multisig payment that has not been fully signed and executed within this window expires and can no longer be executed.

**Business impact:** Shorter expiry reduces the window for a compromised signer to delay a payment indefinitely. Longer expiry gives signers more time to co-sign across time zones. Should be tuned to the typical signing cadence of the organisation using multisig.

---

## Summary Table

| Setting | Default | Min / Max | Setter |
|---------|---------|-----------|--------|
| Platform fee | 0 bps | 0 – 10 000 bps | `set_platform_fee` |
| Refund window | 30 days | ≥ 1 hour | `set_refund_window` |
| Large-payment threshold | 10 XLM | > 0 | `set_large_payment_threshold` |
| Cleanup period | 30 days | > 0 | `set_payment_cleanup_period` |
| Min refund amount | 100 stroops | > 0 | `set_min_refund_amount` |
| Multisig expiry | 7 days | > 0 | `set_multisig_expiry_duration` |

All setters require the `admin` address and will fail with `Unauthorized` if called by any other account.
