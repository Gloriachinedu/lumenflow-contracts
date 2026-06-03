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