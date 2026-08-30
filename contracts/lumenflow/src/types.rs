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
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BatchPaymentItem {
    pub order_id: String,
    pub merchant_address: Address,
    pub token_address: Address,
    pub amount: i128,
    pub memo: String,
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

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MultisigPayment {
    pub payment_id: String,
    pub merchant_address: Address,
    pub token: Address,
    pub amount: i128,
    pub required_signatures: u32,
    pub signers: Vec<Address>,
    pub signatures: Vec<Bytes>,
    pub executed: bool,
    pub created_at: u64,
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
pub struct PaymentPage {
    pub payments: Vec<PaymentOrder>,
    pub next_cursor: Option<String>,
    pub total: u32,
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

// ── Suspicious Activity ───────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SuspiciousActivityReason {
    LargePayment = 1,
    RapidRefunds = 2,
    ManyAuthFailures = 3,
}

// ── Background job recovery (#822) ───────────────────────────────────────────

/// The kind of operation a recoverable job represents.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JobKind {
    /// A single payment via `process_payment_with_signature`.
    Payment,
    /// A batch payment via `batch_payment`.
    BatchPayment,
    /// A refund execution via `execute_refund`.
    RefundExecution,
    /// A multisig payment execution via `execute_multisig_payment`.
    MultisigExecution,
}

/// Lifecycle state of a recoverable job.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JobStatus {
    /// Job has been registered but not yet started.
    Pending,
    /// Job is currently being processed.
    InProgress,
    /// Job completed successfully.
    Completed,
    /// Job failed; eligible for recovery.
    Failed,
    /// Job was interrupted and subsequently recovered.
    Recovered,
}

/// A recoverable unit of work stored on-chain so that interrupted payment
/// processing can be detected and retried by an admin or the original caller.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingJob {
    /// Unique job identifier (caller-chosen).
    pub job_id: String,
    /// What kind of operation this job represents.
    pub kind: JobKind,
    /// The primary entity this job acts on (order_id, refund_id, etc.).
    pub entity_id: String,
    /// The address that initiated the job.
    pub initiator: Address,
    /// Current lifecycle state.
    pub status: JobStatus,
    /// Ledger timestamp when the job was registered.
    pub created_at: u64,
    /// Ledger timestamp of the last status update.
    pub updated_at: u64,
    /// Optional failure reason (set when status = Failed).
    pub failure_reason: Option<String>,
    /// Number of recovery attempts so far.
    pub retry_count: u32,
}
