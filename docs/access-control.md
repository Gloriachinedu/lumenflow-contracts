# Contract Access Control

This matrix covers every public entry point in `contracts/lumenflow/src/lib.rs`.
Soroban `require_auth()` rejects a missing authorization at the host level; that
failure is not a `PaymentError`. Role or ownership checks return
`PaymentError::Unauthorized`. Other errors listed below are additional checks,
not authorization failures.

| Function | Required caller | Auth mechanism | Error if unauthorized |
|---|---|---|---|
| `set_admin` | Address being installed as admin | `admin.require_auth()` | Soroban authorization failure if the address does not authorize; `AdminAlreadySet` if initialized |
| `set_payment_cleanup_period` | Stored admin | `require_admin` (`require_auth` plus stored-admin comparison) | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the stored admin |
| `set_large_payment_threshold` | Stored admin | `require_admin` | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the stored admin |
| `set_max_refunds_per_order` | Stored admin | `require_admin` | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the stored admin |
| `register_merchant` | Address being registered | `merchant_address.require_auth()` | Soroban authorization failure if unsigned |
| `deactivate_merchant` | Stored admin | `require_admin` | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the stored admin |
| `verify_merchant` | Stored admin | `require_admin` | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the stored admin |
| `unverify_merchant` | Stored admin | `require_admin` | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the stored admin |
| `get_merchant` | None (public) | None | None |
| `is_registered` | None (public) | None | None |
| `process_payment_with_signature` | Payer; merchant also signs the payment payload | `payer.require_auth()` and Ed25519 signature verification | Soroban authorization failure if payer is unsigned; `InvalidSignature` for an invalid merchant signature |
| `process_payment_with_nonce` | Payer | `payer.require_auth()` | Soroban authorization failure if payer is unsigned |
| `batch_payment` | Payer; each merchant signs its payment item | `payer.require_auth()` and per-item Ed25519 signature verification | Soroban authorization failure if payer is unsigned; `InvalidSignature` for an invalid merchant signature |
| `get_payment_by_id` | Authenticated payer, merchant, or stored admin for that payment | `caller.require_auth()`, then payer/merchant/admin identity comparison | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if caller is not related to the payment and is not admin |
| `add_payment_note` | Payment's merchant | `merchant.require_auth()`, then merchant identity comparison | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the payment's merchant |
| `get_payment_summary` | None (public) | None | None |
| `update_payment_status` | Stored admin or payment's merchant | `require_admin_or` (`require_auth` plus admin/merchant comparison) | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if neither admin nor merchant |
| `archive_payment_record` | Stored admin | `require_admin` | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the stored admin |
| `cleanup_expired_payments` | Stored admin | `require_admin` | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the stored admin |
| `get_merchant_payment_history` | Merchant whose history is requested | `merchant.require_auth()` | Soroban authorization failure if unsigned |
| `get_payer_payment_history` | Payer whose history is requested | `payer.require_auth()` | Soroban authorization failure if unsigned |
| `get_global_payment_stats` | Stored admin | `require_admin` | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the stored admin |
| `initiate_refund` | Payment's payer or merchant | `caller.require_auth()`, then payer/merchant identity comparison | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the payer or merchant |
| `approve_refund` | Stored admin or related payment's merchant | `require_admin_or` | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if neither admin nor merchant |
| `reject_refund` | Stored admin or related payment's merchant | `require_admin_or` | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if neither admin nor merchant |
| `execute_refund` | Related payment's merchant | Token transfer invokes merchant authorization for the transfer from the merchant to the payer | Soroban authorization failure if merchant does not authorize the transfer |
| `get_refund` | None (public) | None | None |
| `dispute_refund` | Payer who initiated the refund | `payer.require_auth()`, then refund-initiator identity comparison | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the refund initiator |
| `resolve_dispute` | Stored admin; merchant authorization is also required by the token transfer when the outcome favors the payer | `require_admin`; token transfer authorization on the merchant source address | Soroban authorization failure if admin or required merchant authorization is missing; `PaymentError::Unauthorized` if caller is not the stored admin |
| `initiate_multisig_payment` | Payment initiator | `initiator.require_auth()` | Soroban authorization failure if initiator is unsigned |
| `sign_multisig_payment` | Listed multisig signer | `signer.require_auth()`, then signer-list membership check | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not a listed signer |
| `execute_multisig_payment` | Payer funding the payment | `payer.require_auth()`; token transfer also authorizes the payer as source | Soroban authorization failure if payer is unsigned |
| `create_subscription_plan` | Existing, active merchant | `merchant.require_auth()`, then merchant lookup and active-status check | Soroban authorization failure if unsigned; `MerchantNotFound` or `MerchantInactive` if not an eligible merchant |
| `subscribe` | Subscriber | `subscriber.require_auth()` | Soroban authorization failure if subscriber is unsigned |
| `charge_subscription` | Anyone may trigger the charge; the subscriber must authorize the token transfer | No explicit caller auth; token transfer requires subscriber authorization | Soroban authorization failure if subscriber does not authorize the token transfer |
| `cancel_subscription` | Subscriber for the subscription | `subscriber.require_auth()`, then subscription-owner comparison | Soroban authorization failure if unsigned; `PaymentError::Unauthorized` if not the subscription owner |
| `create_payment_request` | Merchant creating the request | `merchant.require_auth()` | Soroban authorization failure if merchant is unsigned |
| `pay_payment_request` | Payer | `payer.require_auth()`; token transfer also authorizes the payer as source | Soroban authorization failure if payer is unsigned |

`require_admin` and `require_admin_or` are implemented in
`contracts/lumenflow/src/helper.rs`; the role-mismatch error is
`PaymentError::Unauthorized` from `contracts/lumenflow/src/error.rs`.

Update this matrix whenever a public contract function is added, removed, or its
authorization behavior changes. Review it against `lib.rs` in every contract
change pull request.