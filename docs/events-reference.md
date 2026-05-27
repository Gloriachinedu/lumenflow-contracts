# LumenFlow Events Reference

This document describes the events emitted by the LumenFlow smart contract.

## Event Structure

All events are emitted with the topic `("lumenflow", <event_name>)`.

## Events List

### `admin_set`
Emitted when the admin is successfully initialized.
- **Topics**: `("lumenflow", "admin_set")`
- **Data**: `admin: Address`

### `payment_processed`
Emitted when a payment is successfully completed.
- **Topics**: `("lumenflow", "payment_processed")`
- **Data**: `(order_id: String, payer: Address, merchant: Address, amount: i128)`

### `suspicious_activity`
Emitted when a threshold for suspicious activity is exceeded.
- **Topics**: `("lumenflow", "suspicious_activity")`
- **Data**: `(reason: SuspiciousActivityReason, actor: Address, value: i128)`

#### Suspicious Activity Reasons:
- `LargePayment` (1): A payment exceeded the `LargePaymentThreshold`.
- `RapidRefunds` (2): Multiple refunds initiated in a short period (Future).
- `ManyAuthFailures` (3): Multiple authentication failures detected (Future).

## Thresholds

Thresholds are configurable by the admin.

| Threshold | Default | Description |
|-----------|---------|-------------|
| `LargePaymentThreshold` | 10,000,000 | Payments above this amount trigger a `suspicious_activity` event. |
| `CleanupPeriod` | 2,592,000 | Seconds (30 days) before a payment is eligible for cleanup. |
