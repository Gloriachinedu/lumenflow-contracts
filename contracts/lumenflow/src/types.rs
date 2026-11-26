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
    /// A custom category string. Must be non-empty, at most 64 characters,
    /// and contain only alphanumeric characters and spaces.
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
    /// Optional maximum payment amount this merchant will accept. `None` means
    /// no limit is enforced (issue #1592).
    pub max_payment_amount: Option<i128>,
}

/// Per-merchant profile settings that can be configured by the merchant.
///
/// `refund_window_secs` overrides the global refund window for this merchant
/// when set. When `None`, the contract-wide default is used.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerchantProfile {
    /// The merchant this profile belongs to.
    pub merchant: Address,
    /// Merchant-specific refund window in seconds. When `None`, the global
    /// default refund window applies.
    pub refund_window_secs: Option<u64>,
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

// ── Merchant tiers ────────────────────────────────────────────────────────────

/// Volume-based merchant tier. Assigned automatically from the merchant's
/// rolling 30-day payment volume against the configured thresholds.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum MerchantTier {
    Standard,
    Silver,
    Gold,
    Platinum,
}

/// Admin-configurable tier thresholds and fee reductions.
///
/// Each threshold is the minimum rolling 30-day volume (in stroops) required
/// to reach that tier. `*_reduction_bps` is the percentage of the platform fee
/// waived for merchants in that tier (e.g. 5000 = 50 % reduction).
/// Defaults: Standard = full fee, Silver = 25 % reduction,
/// Gold = 50 % reduction, Platinum = 100 % reduction (no fee).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerchantTierConfig {
    pub silver_threshold: i128,
    pub gold_threshold: i128,
    pub platinum_threshold: i128,
    pub silver_reduction_bps: u32,
    pub gold_reduction_bps: u32,
    pub platinum_reduction_bps: u32,
}

/// Snapshot returned by `get_merchant_tier`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerchantTierInfo {
    /// The merchant's current tier.
    pub tier: MerchantTier,
    /// Rolling 30-day payment volume used to determine the tier.
    pub rolling_volume: i128,
    /// Effective platform fee in basis points after the tier reduction.
    pub fee_bps: u32,
    /// Volume required to reach the next tier, or `None` if already Platinum.
    pub next_tier_threshold: Option<i128>,
}

/// Data payload for `lumenflow/merchant_tier_changed`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerchantTierChangedEvent {
    pub merchant: Address,
    pub previous_tier: MerchantTier,
    pub new_tier: MerchantTier,
    pub rolling_volume: i128,
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
    pub version: u32,
    pub status: PaymentStatus,
    pub paid_at: u64,
    pub refunded_amount: i128,
    pub memo: String,
    pub tags: Option<Vec<String>>,
    pub platform_fee: i128,
}

/// Public, unauthenticated read-only summary of a payment.
///
/// Returned by `get_payment_summary`, which is callable without payer or
/// merchant auth so third-party explorers and dashboards can query it.
/// Deliberately excludes sensitive fields such as the payer address.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentSummary {
    pub order_id: String,
    pub merchant: Address,
    pub amount: i128,
    pub status: PaymentStatus,
    pub created_at: u64,
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

// ── Merchant registration commitment (commit-reveal, issue #614) ─────────────

/// A pending commitment created by `commit_merchant_registration`.
/// Stored until the merchant calls `reveal_merchant_registration`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MerchantCommitment {
    /// The address that submitted the commitment.
    pub merchant_address: Address,
    /// SHA-256 hash of the pre-image: `merchant_address_bytes ++ name_bytes ++ nonce_bytes`.
    pub commitment_hash: Bytes,
    /// Ledger sequence at which this commitment was submitted.
    pub committed_at_ledger: u32,
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

/// Paginated result returned by `list_active_escrows`.
///
/// Contains only escrows whose status is `EscrowStatus::Locked`, sorted by
/// `unlock_at` ascending (soonest expiring first).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaginatedEscrows {
    /// The escrows on the requested page.
    pub escrows: Vec<EscrowRecord>,
    /// The 1-based page number that was requested.
    pub page: u32,
    /// The maximum number of records per page that was requested.
    pub limit: u32,
    /// Total number of active (locked) escrows before pagination is applied.
    pub total: u32,
}

/// Escrow state for conditional (condition-hash) holds.
///
/// Unlike time-locked escrows the funds here are held until an arbiter
/// releases them (or the payer cancels before the timeout).  The
/// `condition_hash` is a SHA-256 commitment to the off-chain condition
/// document; it is recorded on-chain for auditability but is not verified
/// inside the contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum EscrowHoldStatus {
    /// Funds are locked and waiting for arbiter release or timeout.
    Held,
    /// Arbiter or timeout released funds to merchant.
    Released,
    /// Payer cancelled before timeout; funds returned.
    Cancelled,
}

/// A conditional escrow hold — funds locked until arbiter or timeout.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowHold {
    /// Unique identifier for this escrow hold.
    pub escrow_id: String,
    /// The payer that deposited funds.
    pub payer: Address,
    /// Merchant that receives funds on release.
    pub merchant: Address,
    /// SPtoken contract address.
    pub token: Address,
    /// Amount held in stroops.
    pub amount: i128,
    /// SHA-256 hash of the off-chain condition document.
    pub condition_hash: Bytes,
    /// Arbiter address that may call `escrow_release`.
    pub arbiter: Address,
    /// Unix timestamp after which `escrow_release` can be called by anyone
    /// (timeout fallback for the merchant).
    pub timeout_at: u64,
    pub status: EscrowHoldStatus,
    pub created_at: u64,
}

/// Data payload for `lumenflow/escrow_held`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowHeldEvent {
    pub escrow_id: String,
    pub payer: Address,
    pub merchant: Address,
    pub amount: i128,
    pub condition_hash: Bytes,
}

/// Data payload for `lumenflow/escrow_released`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowReleasedEvent {
    pub escrow_id: String,
    pub merchant: Address,
    pub amount: i128,
}

/// Data payload for `lumenflow/escrow_cancelled`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowCancelledEvent {
    pub escrow_id: String,
    pub payer: Address,
    pub amount: i128,
}

/// Data payload for `lumenflow/emergency_withdrawal`.
///
/// Emitted when an admin triggers an emergency withdrawal of stuck escrow
/// funds to the governance treasury after the emergency lock period.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EmergencyWithdrawalEvent {
    /// The escrow order_id from which funds were withdrawn.
    pub escrow_id: String,
    /// Amount transferred to the treasury in stroops.
    pub amount: i128,
    /// The treasury address that received the funds.
    pub recipient: Address,
}

// ── Dispute ───────────────────────────────────────────────────────────────────

/// Full lifecycle state machine for a dispute.
///
/// ```text
/// Open → UnderReview → Resolved(MerchantFavor | PayerFavor)
///      ↘              ↗
///        Escalated ──→
/// ```
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeStatus {
    /// Dispute has been opened; awaiting admin review.
    Open,
    /// Admin has marked the dispute under active review.
    UnderReview,
    /// Admin has resolved the dispute in favour of one party.
    Resolved,
    /// Admin has escalated the dispute (e.g. to an external arbitration layer).
    Escalated,
}

impl DisputeStatus {
    /// Returns `true` if a transition from `self` to `target` is allowed.
    ///
    /// The only legal transitions are:
    ///
    /// ```text
    /// Open         → UnderReview
    /// Open         → Escalated
    /// UnderReview  → Escalated
    /// UnderReview  → Resolved
    /// Escalated    → Resolved
    /// ```
    ///
    /// Every other source→target pair (including self-transitions and any
    /// transition out of `Resolved`, which is terminal) returns `false`.
    pub fn can_transition_to(&self, target: &DisputeStatus) -> bool {
        matches!(
            (self, target),
            (DisputeStatus::Open, DisputeStatus::UnderReview)
                | (DisputeStatus::Open, DisputeStatus::Escalated)
                | (DisputeStatus::UnderReview, DisputeStatus::Escalated)
                | (DisputeStatus::UnderReview, DisputeStatus::Resolved)
                | (DisputeStatus::Escalated, DisputeStatus::Resolved)
        )
    }
}

/// Final outcome recorded when a dispute is resolved.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeOutcome {
    /// Resolved in the merchant's favour; no forced refund is issued.
    MerchantFavor,
    /// Resolved in the payer's favour; a forced refund is executed.
    PayerFavor,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeRecord {
    /// Unique identifier for this dispute.
    pub dispute_id: String,
    /// The order being disputed.
    pub order_id: String,
    /// The refund associated with this dispute (if any). May be empty if
    /// `initiate_dispute` is called before a refund exists.
    pub refund_id: String,
    /// The party that opened the dispute (payer or merchant).
    pub initiator: Address,
    /// Human-readable reason; maximum 256 characters.
    pub reason: String,
    pub status: DisputeStatus,
    /// Set when the dispute is resolved.
    pub outcome: Option<DisputeOutcome>,
    /// Optional resolution or escalation notes written by the admin.
    pub resolution: Option<String>,
    pub created_at: u64,
}

// ── Fee module ────────────────────────────────────────────────────────────────

/// Protocol fee configuration.
///
/// The fee is expressed in basis points (1 bps = 0.01 %). A `bps` value of `0`
/// disables the fee module entirely: no fee is deducted and no extra token
/// transfer is performed during payment processing.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct FeeConfig {
    /// Address that receives the deducted protocol fee.
    pub recipient: Address,
    /// Fee in basis points. Must be ≤ 10_000 (100 %). `0` disables the module.
    pub bps: u32,
}

// ── Cross-asset payments ──────────────────────────────────────────────────────

/// Data payload for `lumenflow/cross_asset_payment`.
///
/// Emitted by `process_payment_cross_asset` after a DEX path payment has been
/// executed. `exchange_rate` is the effective rate expressed in basis points
/// scaled by 10_000 (i.e. `received_amount * 10_000 / send_amount`).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CrossAssetPaymentEvent {
    pub order_id: String,
    pub payer: Address,
    pub merchant: Address,
    /// Asset the payer sent.
    pub send_asset: Address,
    /// Asset the merchant received.
    pub dest_asset: Address,
    /// Amount of `send_asset` debited from the payer.
    pub send_amount: i128,
    /// Amount of `dest_asset` credited to the merchant.
    pub received_amount: i128,
    /// Effective exchange rate in basis points (received * 10_000 / sent).
    pub exchange_rate: u32,
    pub timestamp: u64,
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

// ── Diagnostic event payloads (issue #1589) ───────────────────────────────────
//
// These events are emitted on performance-critical paths so that off-chain
// monitoring (see `lumenflow_exporter.py`) can track contract execution
// metrics. Each payload carries a `ledger_sequence_delta` — the difference
// between the ledger sequence at which the operation was observed and the
// ledger sequence at which it was initiated — which serves as a
// duration-equivalent measure of execution latency.

/// Topic symbol for the payment-processed diagnostic event.
pub const TOPIC_PAYMENT_PROCESSED_DIAGNOSTIC: &str = "payment_processed_diagnostic";
/// Topic symbol for the refund-issued diagnostic event.
pub const TOPIC_REFUND_ISSUED_DIAGNOSTIC: &str = "refund_issued_diagnostic";
/// Topic symbol for the batch-payment-completed diagnostic event.
pub const TOPIC_BATCH_PAYMENT_COMPLETED_DIAGNOSTIC: &str = "batch_payment_completed_diagnostic";

/// Data payload for `lumenflow/payment_processed_diagnostic`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentProcessedDiagnostic {
    pub order_id: String,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    /// Ledger sequence delta (duration-equivalent) for this operation.
    pub ledger_sequence_delta: u32,
}

/// Data payload for `lumenflow/refund_issued_diagnostic`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RefundIssuedDiagnostic {
    pub refund_id: String,
    pub order_id: String,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    /// Ledger sequence delta (duration-equivalent) for this operation.
    pub ledger_sequence_delta: u32,
}

/// Data payload for `lumenflow/batch_payment_completed_diagnostic`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchPaymentCompletedDiagnostic {
    /// Number of payments successfully processed in the batch.
    pub batch_size: u32,
    /// Aggregate amount processed across the batch.
    pub total_amount: i128,
    /// Ledger sequence delta (duration-equivalent) for the whole batch.
    pub ledger_sequence_delta: u32,
}

// ── Admin Audit Log ───────────────────────────────────────────────────────────

/// The type of admin action recorded in the audit log.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum AdminActionType {
    SetAdmin,
    TransferAdmin,
    PauseContract,
    UnpauseContract,
    AddAllowedToken,
    RemoveAllowedToken,
    SetPlatformFee,
    SetLargePaymentThreshold,
    SetPaymentCleanupPeriod,
    SetMultisigExpiryDuration,
    SetRefundWindow,
    SetMinRefundAmount,
    SetMerchantRefundWindow,
    DeactivateMerchant,
    ReactivateMerchant,
    VerifyMerchant,
    UnverifyMerchant,
    ArchivePaymentRecord,
    CleanupExpiredPayments,
    SetPauseGuardians,
    UpgradeContract,
    ConfirmMerchantDataDeletion,
    EmergencyWithdraw,
    SuspendMerchant,
    UnsuspendMerchant,
    Other,
}

/// A single immutable entry in the admin audit log.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AdminAuditEntry {
    /// Sequential index (0-based) of this entry in the log.
    pub index: u32,
    /// The type of admin action performed.
    pub action: AdminActionType,
    /// The admin address that performed the action.
    pub caller: Address,
    /// Optional human-readable summary of key parameters (e.g. "token=C...").
    pub params: String,
    /// Unix timestamp of the ledger at the time of the action.
    pub timestamp: u64,
    /// Ledger sequence number at the time of the action.
    pub ledger_sequence: u32,
}
