use soroban_sdk::contracterror;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PaymentError {
    // Auth
    Unauthorized = 1,
    AdminAlreadySet = 2,
    InvalidAdminAddress = 3,

    // Merchant
    MerchantNotFound = 10,
    MerchantAlreadyRegistered = 11,
    MerchantInactive = 12,

    // Payment
    PaymentNotFound = 20,
    PaymentAlreadyExists = 21,
    InvalidAmount = 22,
    InvalidSignature = 23,
    PaymentExpired = 24,
    InsufficientBalance = 25,
    TokenNotAllowed = 26,

    // Refund
    RefundNotFound = 30,
    RefundAlreadyExists = 31,
    RefundWindowExpired = 32,
    RefundExceedsOriginal = 33,
    RefundNotApproved = 34,
    RefundAlreadyCompleted = 35,
    TooManyRefunds = 36,
    RefundNotRejected = 37,

    // Dispute
    DisputeAlreadyExists = 38,
    DisputeNotFound = 39,

    // Multisig
    MultisigNotFound = 40,
    MultisigAlreadySigned = 41,
    MultisigAlreadyExecuted = 42,
    InsufficientSignatures = 43,

    // General
    InvalidInput = 50,
    PaginationLimitExceeded = 51,
    BatchSizeExceeded = 52,
    InvalidTags = 53,
    InvalidNonce = 54,

    // Subscription
    SubscriptionPlanAlreadyExists = 60,
    SubscriptionAlreadyExists = 61,
    SubscriptionPlanNotFound = 62,
    SubscriptionNotFound = 63,
    SubscriptionNotActive = 64,
    SubscriptionMaxCyclesReached = 65,
    SubscriptionIntervalNotElapsed = 66,
}
