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

    // Multisig
    /// The multi-signature payment request was not found. Remediation: Verify the payment ID.
    MultisigNotFound = 40,
    /// The caller has already signed this multi-signature payment. Remediation: Wait for other required signers.
    MultisigAlreadySigned = 41,
    /// The multi-signature payment has already been executed. Remediation: No action needed.
    MultisigAlreadyExecuted = 42,
    /// The multi-signature payment lacks the required number of signatures to execute. Remediation: Collect more signatures from authorized signers.
    InsufficientSignatures = 43,

    // General
    /// The provided input parameters are invalid. Remediation: Check the input values and format.
    InvalidInput = 50,
    /// The requested limit for pagination exceeds the maximum allowed (100). Remediation: Use a limit of 100 or less.
    PaginationLimitExceeded = 51,
    /// The batch operation exceeds the maximum allowed items. Remediation: Reduce the number of items in the batch.
    BatchSizeExceeded = 52,
    /// The provided tags exceed length or count limits. Remediation: Ensure tags are within the allowed limits (e.g., max 5 tags, max 20 chars per tag).
    InvalidTags = 53,

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
}
