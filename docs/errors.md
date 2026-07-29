# LumenFlow Contract Error Codes

This document lists all the error codes returned by the LumenFlow contract, along with their descriptions and suggested remediation steps.

## Auth Errors

| Error Name | Code | Description | Remediation |
| :--- | :--- | :--- | :--- |
| `Unauthorized` | 1 | The caller is not authorized to perform the action. | Ensure the caller has signed the transaction and has the required role (e.g., admin, merchant). |
| `AdminAlreadySet` | 2 | The contract administrator has already been initialized. | Admin initialization can only happen once. |
| `InvalidAdminAddress` | 3 | The provided admin address is invalid. | Ensure a valid Stellar address is passed. |
| `InvalidNonce` | 4 | The provided nonce does not match the expected value. | Fetch the current nonce and increment by 1. |

## Merchant Errors

| Error Name | Code | Description | Remediation |
| :--- | :--- | :--- | :--- |
| `MerchantNotFound` | 10 | The requested merchant profile does not exist. | Check the merchant address and ensure the merchant is registered. |
| `MerchantAlreadyRegistered` | 11 | A merchant profile already exists for the given address. | Use the existing profile or register with a different address. |
| `MerchantInactive` | 12 | The merchant profile is deactivated. | An admin must reactivate the merchant profile to resume operations. |

## Payment Errors

| Error Name | Code | Description | Remediation |
| :--- | :--- | :--- | :--- |
| `PaymentNotFound` | 20 | The specified payment was not found. | Verify the payment ID or order ID. |
| `PaymentAlreadyExists` | 21 | A payment with the given order ID already exists. | Use a unique order ID for each payment. |
| `InvalidAmount` | 22 | The payment amount is zero or negative. | Provide a positive, non-zero amount. |
| `InvalidSignature` | 23 | The provided Ed25519 signature is invalid or does not match the payload. | Ensure the payload is correctly constructed and signed with the correct private key. |
| `PaymentExpired` | 24 | The payment request has expired. | Create a new payment request. |
| `InsufficientBalance` | 25 | The payer does not have enough tokens to complete the payment. | Ensure the payer has sufficient funds in the specified token. |
| `TokenNotAllowed` | 26 | The specified token is not accepted. | Use a supported token. |

## Refund Errors

| Error Name | Code | Description | Remediation |
| :--- | :--- | :--- | :--- |
| `RefundNotFound` | 30 | The requested refund was not found. | Verify the refund ID. |
| `RefundAlreadyExists` | 31 | A refund with the given ID already exists. | Use a unique refund ID. |
| `RefundWindowExpired` | 32 | The allowed time window for initiating a refund has passed. | Refunds must be initiated within 30 days of the payment. |
| `RefundExceedsOriginal` | 33 | The total refund amount exceeds the original payment amount. | Ensure the refund amount (or cumulative partial refunds) does not exceed the original payment. |
| `RefundNotApproved` | 34 | The refund has not been approved yet. | The merchant or admin must approve the refund before it can be executed. |
| `RefundAlreadyCompleted` | 35 | The refund has already been executed. | No action needed; the refund is complete. |
| `TooManyRefunds` | 36 | The maximum number of partial refunds for a single payment has been reached. | Consolidate refund amounts or resolve off-chain. |
| `RefundNotRejected` | 37 | The refund cannot be disputed because it was not rejected. | Only rejected refunds can be disputed. |
| `DisputeAlreadyExists` | 38 | A dispute already exists for this refund. | Check the existing dispute status. |
| `DisputeNotFound` | 39 | The requested dispute was not found. | Verify the refund ID. |

## Multisig Errors

| Error Name | Code | Description | Remediation |
| :--- | :--- | :--- | :--- |
| `MultisigNotFound` | 40 | The multi-signature payment request was not found. | Verify the payment ID. |
| `MultisigAlreadySigned` | 41 | The caller has already signed this multi-signature payment. | Wait for other required signers. |
| `MultisigAlreadyExecuted` | 42 | The multi-signature payment has already been executed. | No action needed. |
| `InsufficientSignatures` | 43 | The multi-signature payment lacks the required number of signatures to execute. | Collect more signatures from authorized signers. |

## General Errors

| Error Name | Code | Description | Remediation |
| :--- | :--- | :--- | :--- |
| `InvalidInput` | 50 | The provided input parameters are invalid. | Check the input values and format. |
| `PaginationLimitExceeded` | 51 | The requested limit for pagination exceeds the maximum allowed (100). | Use a limit of 100 or less. |
| `BatchSizeExceeded` | 52 | The batch operation exceeds the maximum allowed items. | Reduce the number of items in the batch. |
| `InvalidTags` | 53 | The provided tags exceed length or count limits. | Ensure tags are within the allowed limits (e.g., max 5 tags, max 20 chars per tag). |

## Subscription Errors

| Error Name | Code | Description | Remediation |
| :--- | :--- | :--- | :--- |
| `SubscriptionPlanAlreadyExists` | 60 | A subscription plan with the given ID already exists. | Use a unique plan ID. |
| `SubscriptionAlreadyExists` | 61 | A subscription with the given ID already exists. | Use a unique subscription ID. |
| `SubscriptionPlanNotFound` | 62 | The requested subscription plan was not found. | Verify the plan ID. |
| `SubscriptionNotFound` | 63 | The requested subscription was not found. | Verify the subscription ID. |
| `SubscriptionNotActive` | 64 | The subscription is not active. | Ensure the subscription is not cancelled or completed. |
| `SubscriptionMaxCyclesReached` | 65 | The subscription has reached its maximum number of charging cycles. | Create a new subscription if needed. |
| `SubscriptionIntervalNotElapsed` | 66 | The required interval between subscription charges has not elapsed. | Wait for the next billing cycle. |
## Error Handling Examples

These examples describe common contract error codes and how to resolve them in client integrations.

### Invalid signature or merchant payload issues

If the contract returns `PaymentError::InvalidSignature` (code `23`), the client should:

- Rebuild the signed payload exactly as the contract expects.
- Use the merchant's Ed25519 private key to sign the payload.
- Verify that the payload includes `order_id` and `amount` in the correct canonical format.
- Retry with a fresh signature if the original request failed.

### Duplicate order IDs

If the contract returns `PaymentError::PaymentAlreadyExists` (code `21`), the client should:

- Generate a unique `order_id` for each payment.
- Avoid retrying the same order ID unless the previous transaction was confirmed to have failed.
- If the payment was already created, use the existing record or query `get_payment_summary`.

### Authorization and role errors

If the contract returns `PaymentError::Unauthorized` (code `1`), the client should:

- Ensure the caller address is the correct signer for the requested entrypoint.
- Confirm the caller is the configured admin for admin-only calls.
- For merchant actions, verify the merchant address matches the authenticated signer.

### Missing or invalid inputs

If the contract returns `PaymentError::InvalidInput` (code `50`), the client should:

- Confirm string fields are non-empty and within the allowed length limits.
- Confirm IDs are unique, non-empty, and at most 64 characters.
- Confirm `limit` values are between 1 and 100 for pagination calls.

### Not found errors

If the contract returns `PaymentError::PaymentNotFound` (code `20`) or `PaymentError::MerchantNotFound` (code `10`), the client should:

- Verify the requested `order_id` or merchant address is correct.
- If appropriate, re-register the merchant or create the missing payment request.
- For read calls, present a user-friendly message that the requested item does not exist.

### Refund and lifecycle errors

If the contract returns `PaymentError::RefundWindowExpired` (code `32`), the client should:

- Inform the user that the refund window has closed.
- Offer alternative support channels for manual dispute resolution.

If the contract returns `PaymentError::RefundExceedsOriginal` (code `33`), the client should:

- Ensure the cumulative refund amount does not exceed the original payment amount.
- Adjust the refund request to a valid amount.

## Regression Test Coverage

Every error code listed above has a dedicated regression test in
[`contracts/lumenflow/tests/test_error_codes.rs`](../contracts/lumenflow/tests/test_error_codes.rs).
Tests follow the naming convention `test_error_{code_name}_is_triggered`.

| Error Name | Test |
| :--- | :--- |
| `Unauthorized` | `test_error_unauthorized_is_triggered` |
| `AdminAlreadySet` | `test_error_admin_already_set_is_triggered` |
| `InvalidAdminAddress` | `test_error_invalid_admin_address_is_triggered` |
| `InvalidNonce` | `test_error_invalid_nonce_is_triggered` |
| `AuthLockedOut` | `test_error_auth_locked_out_is_triggered` |
| `MerchantNotFound` | `test_error_merchant_not_found_is_triggered` |
| `MerchantAlreadyRegistered` | `test_error_merchant_already_registered_is_triggered` |
| `MerchantInactive` | `test_error_merchant_inactive_is_triggered` |
| `PaymentNotFound` | `test_error_payment_not_found_is_triggered` |
| `PaymentAlreadyExists` | `test_error_payment_already_exists_is_triggered` |
| `InvalidAmount` | `test_error_invalid_amount_is_triggered` |
| `InvalidSignature` | `test_error_invalid_signature_is_triggered` |
| `PaymentExpired` | `test_error_payment_expired_is_triggered` |
| `TokenNotAllowed` | `test_error_token_not_allowed_is_triggered` |
| `RefundNotFound` | `test_error_refund_not_found_is_triggered` |
| `RefundAlreadyExists` | `test_error_refund_already_exists_is_triggered` |
| `RefundWindowExpired` | `test_error_refund_window_expired_is_triggered` |
| `RefundExceedsOriginal` | `test_error_refund_exceeds_original_is_triggered` |
| `RefundNotApproved` | `test_error_refund_not_approved_is_triggered` |
| `RefundAlreadyCompleted` | `test_error_refund_already_completed_is_triggered` |
| `RefundBelowMinimum` | `test_error_refund_below_minimum_is_triggered` |
| `MultisigNotFound` | `test_error_multisig_not_found_is_triggered` |
| `MultisigAlreadySigned` | `test_error_multisig_already_signed_is_triggered` |
| `MultisigAlreadyExecuted` | `test_error_multisig_already_executed_is_triggered` |
| `InsufficientSignatures` | `test_error_insufficient_signatures_is_triggered` |
| `MultisigAlreadyCancelled` | `test_error_multisig_already_cancelled_is_triggered` |
| `MultisigCancelled` | `test_error_multisig_cancelled_is_triggered` |
| `MultisigExpired` | `test_error_multisig_expired_is_triggered` |
| `ContractPaused` | `test_error_contract_paused_is_triggered` |
| `VersionMismatch` | `test_error_version_mismatch_is_triggered` |
| `TimelockActive` | `test_error_timelock_active_is_triggered` |
| `NotAPauseGuardian` | `test_error_not_a_pause_guardian_is_triggered` |
| `AlreadyApprovedUnpause` | `test_error_already_approved_unpause_is_triggered` |
| `InvalidInput` | `test_error_invalid_input_is_triggered` |
| `PaginationLimitExceeded` | `test_error_pagination_limit_exceeded_is_triggered` |
| `BatchSizeExceeded` | `test_error_batch_size_exceeded_is_triggered` |
| `InvalidTags` | `test_error_invalid_tags_is_triggered` |
| `SubscriptionPlanAlreadyExists` | `test_error_subscription_plan_already_exists_is_triggered` |
| `SubscriptionPlanNotFound` | `test_error_subscription_plan_not_found_is_triggered` |
| `SubscriptionAlreadyExists` | `test_error_subscription_already_exists_is_triggered` |
| `SubscriptionNotFound` | `test_error_subscription_not_found_is_triggered` |
| `SubscriptionNotActive` | `test_error_subscription_not_active_is_triggered` |
| `SubscriptionIntervalNotElapsed` | `test_error_subscription_interval_not_elapsed_is_triggered` |
| `SubscriptionMaxCyclesReached` | `test_error_subscription_max_cycles_reached_is_triggered` |
| `EscrowNotFound` | `test_error_escrow_not_found_is_triggered` |
| `EscrowAlreadyExists` | `test_error_escrow_already_exists_is_triggered` |
| `EscrowNotUnlocked` | `test_error_escrow_not_unlocked_is_triggered` |
| `EscrowAlreadyFinalised` | `test_error_escrow_already_finalised_is_triggered` |
| `EscrowUnauthorised` | `test_error_escrow_unauthorised_is_triggered` |
| `EscrowLockExpired` | `test_error_escrow_lock_expired_is_triggered` |
| `DisputeNotFound` | `test_error_dispute_not_found_is_triggered` |
| `DisputeRefundNotRejected` | `test_error_dispute_refund_not_rejected_is_triggered` |
| `DisputeAlreadyExists` | `test_error_dispute_already_exists_is_triggered` |
| `DisputeAlreadyResolved` | `test_error_dispute_already_resolved_is_triggered` |
