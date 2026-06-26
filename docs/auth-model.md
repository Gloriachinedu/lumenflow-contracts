# LumenFlow Auth Model

Every contract function and its required authorisation.

| Function | Required Auth | Notes |
|---|---|---|
| `set_admin` | `admin` (one-time) | Caller must be the address being set as admin; fails if admin already set |
| `set_payment_cleanup_period` | Admin | |
| `set_large_payment_threshold` | Admin | |
| `set_max_refunds_per_order` | Admin | |
| `register_merchant` | `merchant_address` | Self-registration only |
| `deactivate_merchant` | Admin | |
| `verify_merchant` | Admin | |
| `unverify_merchant` | Admin | |
| `get_merchant` | None | Public read |
| `is_registered` | None | Public read |
| `process_payment_with_signature` | `payer` | Also verifies merchant ed25519 signature over payload |
| `batch_payment` | `payer` | Also verifies per-item merchant ed25519 signatures |
| `get_payment_by_id` | `caller` (payer, merchant, or admin) | Returns `Unauthorized` for anyone else |
| `get_payment_summary` | None | Public summary (no payer address exposed) |
| `update_payment_status` | Admin or merchant | |
| `archive_payment_record` | Admin | |
| `cleanup_expired_payments` | Admin | |
| `get_merchant_payment_history` | `merchant` | Own history only |
| `get_payer_payment_history` | `payer` | Own history only |
| `get_global_payment_stats` | Admin | |
| `initiate_refund` | `caller` (payer or merchant) | Enforced by identity check after auth |
| `approve_refund` | Admin or merchant | |
| `reject_refund` | Admin or merchant | |
| `execute_refund` | `merchant_address` (implicit via `require_auth` on transfer) | |
| `get_refund` | None | Public read |
| `initiate_multisig_payment` | `initiator` | |
| `sign_multisig_payment` | `signer` (must be in signers list) | |
| `get_multisig_payment` | `caller` (admin, merchant, or signer) | |
| `execute_multisig_payment` | `payer` | |
| `create_payment_request` | `merchant` | |
| `pay_payment_request` | `payer` | |

## Auth Helpers (`helper.rs`)

| Helper | Behaviour |
|---|---|
| `require_admin` | Reads stored admin; returns `Unauthorized` if caller doesn't match or admin not set |
| `require_admin_or(caller, other)` | Passes if caller is admin **or** equals `other` |
