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

## Admin Transfer Security (issue #347)

`transfer_admin` is an irreversible, high-impact operation. The following edge cases
are explicitly blocked by the contract:

| Edge case | Error returned | Reason |
|---|---|---|
| `new_admin == current_admin` (self-transfer) | `InvalidAdminAddress` | A self-transfer is a configuration error that silently succeeds and provides no security value. |
| `new_admin` is the zero/all-zeros address | `InvalidAdminAddress` | Setting the zero address as admin would permanently lock the contract because no real key can authenticate as the zero address. |
| Caller is not the current admin | `Unauthorized` | Only the incumbent admin can hand over privileges. |

**Best practices:**

- Always verify `new_admin` is a funded, operational Stellar account before calling
  `transfer_admin`. An accidental transfer to a lost key permanently locks admin access.
- Consider a two-step handover pattern off-chain: have the new admin call a read-only
  admin function to confirm the transfer took effect before decommissioning the old key.
- Audit logs: the `lumenflow/admin_transferred` event emitted on every successful
  transfer provides an on-chain trail for post-incident review.

## Auth Helpers (`helper.rs`)

| Helper | Behaviour |
|---|---|
| `require_admin` | Reads stored admin; returns `Unauthorized` if caller doesn't match or admin not set |
| `require_admin_or(caller, other)` | Passes if caller is admin **or** equals `other` |
