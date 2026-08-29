use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PaymentError {
    // Auth
    /// The caller is not authorized to perform the action. Remediation: Ensure the caller has signed the transaction and has the required role (e.g., admin, merchant).
    Unauthorized = 1,
    /// The contract administrator has already been initialized. Remediation: Admin initialization can only happen once.
    AdminAlreadySet = 2,
    /// The provided admin address is invalid. Remediation: Ensure a valid Stellar address is passed.
    InvalidAdminAddress = 3,
    /// The provided nonce does not match the expected value. Remediation: Fetch the current nonce and increment by 1.
    InvalidNonce = 4,
    /// The address is temporarily locked out due to too many failed authentication attempts.
    /// Remediation: Wait ~83 minutes for the lockout to expire, or ask an admin to call
    /// `reset_auth_lockout` to clear it immediately.
    AuthLockedOut = 5,

    // Merchant
    /// The requested merchant profile does not exist. Remediation: Check the merchant address and ensure the merchant is registered.
    MerchantNotFound = 10,
    /// A merchant profile already exists for the given address. Remediation: Use the existing profile or use a different address.
    MerchantAlreadyRegistered = 11,
    /// The merchant profile is deactivated. Remediation: An admin must reactivate the merchant profile to resume operations.
    MerchantInactive = 12,

    // Payment
    /// The specified payment was not found. Remediation: Verify the payment ID or order ID.
    PaymentNotFound = 20,
    /// A payment with the given order ID already exists. Remediation: Use a unique order ID for each payment.
    PaymentAlreadyExists = 21,
    /// The payment amount is zero or negative. Remediation: Provide a positive, non-zero amount.
    InvalidAmount = 22,
    /// The provided Ed25519 signature is invalid or does not match the payload. Remediation: Ensure the payload is correctly constructed and signed with the correct private key.
    InvalidSignature = 23,
    /// The payment request has expired. Remediation: Create a new payment request.
    PaymentExpired = 24,
    /// The payer does not have enough tokens to complete the payment. Remediation: Ensure the payer has sufficient funds in the specified token.
    InsufficientBalance = 25,
    /// The specified token is not accepted. Remediation: Use a supported token.
    TokenNotAllowed = 26,

    // Refund
    /// The requested refund was not found. Remediation: Verify the refund ID.
    RefundNotFound = 30,
    /// A refund with the given ID already exists. Remediation: Use a unique refund ID.
    RefundAlreadyExists = 31,
    /// The allowed time window for initiating a refund has passed. Remediation: Refunds must be initiated within 30 days of the payment.
    RefundWindowExpired = 32,
    /// The total refund amount exceeds the original payment amount. Remediation: Ensure the refund amount (or cumulative partial refunds) does not exceed the original payment.
    RefundExceedsOriginal = 33,
    /// The refund has not been approved yet. Remediation: The merchant or admin must approve the refund before it can be executed.
    RefundNotApproved = 34,
    /// The refund has already been executed. Remediation: No action needed; the refund is complete.
    RefundAlreadyCompleted = 35,
    RefundBelowMinimum = 36,
    /// The number of refunds for this payment has reached the maximum allowed (10). Remediation: No further refunds can be initiated for this payment.
    RefundLimitExceeded = 37,

    // Multisig
    /// The multi-signature payment request was not found. Remediation: Verify the payment ID.
    MultisigNotFound = 40,
    /// The caller has already signed this multi-signature payment. Remediation: Wait for other required signers.
    MultisigAlreadySigned = 41,
    /// The multi-signature payment has already been executed. Remediation: No action needed.
    MultisigAlreadyExecuted = 42,
    /// The multi-signature payment lacks the required number of signatures to execute. Remediation: Collect more signatures from authorized signers.
    InsufficientSignatures = 43,
    /// The multi-signature payment has already been cancelled. Remediation: No action needed.
    MultisigAlreadyCancelled = 44,
    /// The multi-signature payment has been cancelled. Remediation: No action needed.
    MultisigCancelled = 45,
    /// The multi-signature payment has expired. Remediation: Create a new multisig payment.
    MultisigExpired = 46,

    // Contract state
    /// The contract is currently paused. Remediation: An admin must unpause the contract.
    ContractPaused = 70,
    /// The payment history limit for this account has been exceeded. Remediation: Archive old payments.
    PaymentHistoryLimitExceeded = 71,
    /// Unpause attempted before the 7-day timelock expires. Remediation: Wait for the timelock to expire or use the 3-of-5 multisig early unpause.
    TimelockActive = 72,
    /// Not enough multisig approvals for early unpause. Remediation: Collect at least 3 approvals from registered pause guardians.
    InsufficientUnpauseSignatures = 73,
    /// The signer has already approved the early unpause. Remediation: Wait for other guardians to approve.
    AlreadyApprovedUnpause = 74,
    /// The caller is not a registered pause guardian. Remediation: Only addresses set via set_pause_guardians can approve early unpause.
    NotAPauseGuardian = 75,
    /// The on-chain stored version does not match the binary version. Remediation: Call set_contract_version after upgrading.
    VersionMismatch = 80,

    // General
    /// The provided input parameters are invalid. Remediation: Check the input values and format.
    InvalidInput = 50,
    /// The requested limit for pagination exceeds the maximum allowed (100). Remediation: Use a limit of 100 or less.
    PaginationLimitExceeded = 51,
    /// The batch operation exceeds the maximum allowed items. Remediation: Reduce the number of items in the batch.
    BatchSizeExceeded = 52,
    /// The provided tags exceed length or count limits. Remediation: Ensure tags are within the allowed limits (e.g., max 5 tags, max 20 chars per tag).
    InvalidTags = 53,
    /// The serialized payload for a batch item exceeds the maximum allowed size. Remediation: Reduce the size of memo, order_id, or other string fields.
    SerializedPayloadTooLarge = 54,

    // Referral
    /// The referral address is invalid: either it does not belong to a registered merchant or
    /// the caller attempted to refer themselves. Remediation: Provide a valid, distinct referrer address.
    InvalidReferral = 80,

    // Subscriptions
    /// A subscription plan with the given ID already exists. Remediation: Use a unique plan ID.
    SubscriptionPlanAlreadyExists = 60,
    /// A subscription with the given ID already exists. Remediation: Use a unique subscription ID.
    SubscriptionAlreadyExists = 61,
    /// The requested subscription plan was not found. Remediation: Verify the plan ID.
    SubscriptionPlanNotFound = 62,
    /// The requested subscription was not found. Remediation: Verify the subscription ID.
    SubscriptionNotFound = 63,
    /// The subscription is not active. Remediation: Ensure the subscription is not cancelled or completed.
    SubscriptionNotActive = 64,
    /// The subscription has reached its maximum number of charging cycles. Remediation: Create a new subscription if needed.
    SubscriptionMaxCyclesReached = 65,
    /// The required interval between subscription charges has not elapsed. Remediation: Wait for the next billing cycle.
    SubscriptionIntervalNotElapsed = 66,

    // Rate limiting
    /// The merchant has exceeded the payment rate limit for the current ledger window. Remediation: Wait for the next rate-limit window (~25 minutes) before submitting more payments.
    RateLimitExceeded = 90,

    // Escrow
    /// The requested escrow record was not found. Remediation: Verify the order ID.
    EscrowNotFound = 100,
    /// An escrow record with the given order ID already exists. Remediation: Use a unique order ID.
    EscrowAlreadyExists = 101,
    /// The escrow unlock time has not yet been reached. Remediation: Wait until the unlock_at timestamp before releasing.
    EscrowNotUnlocked = 102,
    /// The escrow has already been released or cancelled. Remediation: No action needed; the escrow is finalised.
    EscrowAlreadyFinalised = 103,
    /// The cancel_escrow_before_lock caller is not the payer of the escrow. Remediation: Only the original payer can cancel an escrow.
    EscrowUnauthorised = 104,
    /// The escrow unlock time has already passed; it can no longer be cancelled. Remediation: Call release_escrow instead.
    EscrowLockExpired = 105,

    // Disputes
    /// The requested dispute was not found. Remediation: Verify the dispute ID.
    DisputeNotFound = 110,
    /// A dispute with the given ID already exists. Remediation: Use a unique dispute ID.
    DisputeAlreadyExists = 111,
    /// A dispute can only be raised on a rejected refund. Remediation: Ensure the refund status is Rejected before raising a dispute.
    DisputeRefundNotRejected = 112,
    /// The dispute has already been resolved. Remediation: No further action needed.
    DisputeAlreadyResolved = 113,
}
