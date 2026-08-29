use soroban_sdk::{contracttype, Address, Bytes, String, Vec};

// ── Merchant ──────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MerchantCategory {
    Retail,
    Food,
    Services,
    Digital,
    Other,
    /// A custom category string. Must be non-empty and at most 32 characters.
    Custom(String),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Merchant {
    pub address: Address,
    pub name: String,
    pub description: String,
    pub contact_info: String,
    pub category: MerchantCategory,
    pub active: bool,
    pub verified: bool,
    pub registered_at: u64,
    pub total_received: i128,
    /// Number of merchants that registered using this merchant's referral address.
    pub referral_count: u32,
}

/// Summary entry returned by `get_referral_stats`. Contains the referring
/// merchant's address, how many merchants they have referred, and the
/// configured referral reward in basis points.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReferralStats {
    pub referrer: Address,
    pub referral_count: u32,
    /// Referral reward in basis points (e.g. 50 = 0.5 % fee reduction).
    pub reward_bps: u32,
}

// ── Payment ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PaymentStatus {
    Completed,
    PartiallyRefunded,
    FullyRefunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentOrder {
    pub order_id: String,
    pub merchant_address: Address,
    pub payer: Address,
    pub token: Address,
    pub amount: i128,
    pub status: PaymentStatus,
    pub paid_at: u64,
    pub refunded_amount: i128,
    pub memo: String,
    pub tags: Option<Vec<String>>,
    pub platform_fee: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentSummary {
    pub order_id: String,
    pub merchant_address: Address,
    pub amount: i128,
    pub token: Address,
    pub status: PaymentStatus,
    pub paid_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentRequest {
    pub request_id: String,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub memo: String,
    pub expires_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchPaymentItem {
    pub order_id: String,
    pub merchant_address: Address,
    pub token_address: Address,
    pub amount: i128,
    pub memo: String,
    /// Optional tags for this batch item. Maximum 5 tags, each 1–32 characters.
    /// Uses the same validation rules as `process_payment_with_signature`.
    pub tags: Option<Vec<String>>,
    pub signature: Bytes,
    pub merchant_public_key: Bytes,
}

// ── Refund ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RefundStatus {
    Pending,
    Approved,
    Rejected,
    Completed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundRecord {
    pub refund_id: String,
    pub order_id: String,
    pub initiator: Address,
    pub amount: i128,
    pub reason: String,
    pub status: RefundStatus,
    pub created_at: u64,
}

// ── Multisig ──────────────────────────────────────────────────────────────────

/// A single entry pairing a signer address with their signature bytes.
/// Stored as one vector instead of two parallel vectors to reduce on-chain
/// storage overhead and keep the signer↔signature relationship explicit.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SignatureEntry {
    pub signer: Address,
    pub signature: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigPayment {
    pub payment_id: String,
    pub initiator: Address,
    pub merchant_address: Address,
    pub token: Address,
    pub amount: i128,
    pub required_signatures: u32,
    pub signers: Vec<Address>,
    /// Collected signatures. Each entry bundles signer address + signature bytes
    /// in a single `SignatureEntry`, replacing the previous two parallel vectors.
    pub collected: Vec<SignatureEntry>,
    pub executed: bool,
    pub cancelled: bool,
    pub created_at: u64,
    pub expires_at: Option<u64>,
}

// ── Query helpers ─────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SortField {
    Date,
    Amount,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SortOrder {
    Ascending,
    Descending,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum StatusFilter {
    Any,
    Completed,
    PartiallyRefunded,
    FullyRefunded,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentFilter {
    pub date_start: Option<u64>,
    pub date_end: Option<u64>,
    pub amount_min: Option<i128>,
    pub amount_max: Option<i128>,
    pub token: Option<Address>,
    pub status: StatusFilter,
    pub tag: Option<String>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerchantPage {
    pub merchants: Vec<Merchant>,
    pub next_cursor: Option<Address>,
    pub total: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentPage {
    pub payments: Vec<PaymentOrder>,
    pub next_cursor: Option<String>,
    /// Total number of records matching the query before page limit is applied.
    pub total_matching: u32,
}

// ── Stats ─────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GlobalStats {
    pub total_payments: u32,
    pub total_volume: i128,
    pub total_refunds: u32,
    pub total_refund_volume: i128,
    pub active_merchants: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerchantStats {
    pub total_payments: u32,
    /// Aggregate volume of completed payments for this merchant. Uses saturating
    /// arithmetic to avoid runtime panics when approaching i128::MAX.
    pub total_volume: i128,
    pub total_refunds: u32,
    /// Aggregate volume of executed refunds for this merchant. Uses saturating
    /// arithmetic to avoid runtime panics when approaching i128::MAX.
    pub total_refund_volume: i128,
}

// ── Escrow ────────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowStatus {
    /// Funds are locked and awaiting the unlock_at timestamp.
    Locked,
    /// Funds have been released to the merchant.
    Released,
    /// Funds have been returned to the payer (cancelled before unlock).
    Cancelled,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowRecord {
    pub order_id: String,
    pub payer: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    /// Unix timestamp after which release_escrow can be called.
    pub unlock_at: u64,
    pub status: EscrowStatus,
    pub created_at: u64,
}

// ── Dispute ───────────────────────────────────────────────────────────────────

/// Lifecycle states of a dispute.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeStatus {
    /// Dispute has been opened and is awaiting admin resolution.
    Open,
    /// Admin has resolved the dispute (with or without a forced refund).
    Resolved,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeRecord {
    /// Unique identifier for this dispute.
    pub dispute_id: String,
    /// The refund record being disputed (must be in `Rejected` state).
    pub refund_id: String,
    pub order_id: String,
    pub initiator: Address,
    pub reason: String,
    pub status: DisputeStatus,
    /// Optional resolution notes written by the admin when resolving.
    pub resolution: Option<String>,
    pub created_at: u64,
}

// ── Suspicious Activity ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SuspiciousActivityReason {
    LargePayment = 1,
    RapidRefunds = 2,
    ManyAuthFailures = 3,
}

// -- Subscriptions -------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubscriptionStatus {
    Active,
    Cancelled,
    Completed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionPlan {
    pub plan_id: String,
    pub token: Address,
    pub amount: i128,
    pub interval_secs: u64,
    pub max_cycles: u32,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Subscription {
    pub subscription_id: String,
    pub plan_id: String,
    pub merchant: Address,
    pub subscriber: Address,
    pub status: SubscriptionStatus,
    pub cycles_charged: u32,
    /// Timestamp the interval is measured from: subscribe time until the first
    /// charge, then the time of the most recent charge.
    pub last_charged_at: u64,
    pub created_at: u64,
}

// ── Event payload types ───────────────────────────────────────────────────────
//
// Each struct below is the canonical schema for a contract event's data field.
// Using `#[contracttype]` ensures the XDR encoding is stable and can be decoded
// off-chain against generated SDK bindings.

/// Data payload for `lumenflow/payment_processed`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentProcessedEvent {
    pub order_id: String,
    pub payer: Address,
    pub merchant: Address,
    pub amount: i128,
}

/// Data payload for `lumenflow/refund_initiated`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundInitiatedEvent {
    pub refund_id: String,
    pub order_id: String,
    pub initiator: Address,
    pub amount: i128,
}

/// Data payload for `lumenflow/refund_approved`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundApprovedEvent {
    pub refund_id: String,
    pub order_id: String,
    pub merchant: Address,
    pub amount: i128,
}

/// Data payload for `lumenflow/refund_rejected`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundRejectedEvent {
    pub refund_id: String,
    pub order_id: String,
    pub merchant: Address,
    pub amount: i128,
}

/// Data payload for `lumenflow/refund_executed`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundExecutedEvent {
    pub refund_id: String,
    pub order_id: String,
    pub payer: Address,
    pub merchant: Address,
    pub amount: i128,
    pub token: Address,
}

/// Data payload for `lumenflow/multisig_initiated`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigInitiatedEvent {
    pub payment_id: String,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub required_signatures: u32,
}

/// Data payload for `lumenflow/multisig_executed`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigExecutedEvent {
    pub payment_id: String,
    pub payer: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
}

/// Data payload for `lumenflow/payment_request_paid`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentRequestPaidEvent {
    pub request_id: String,
    pub payer: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
}

/// Data payload for `lumenflow/payment_status_updated`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentStatusUpdatedEvent {
    pub order_id: String,
    pub status: PaymentStatus,
    pub refunded_amount: i128,
    pub original_amount: i128,
}
