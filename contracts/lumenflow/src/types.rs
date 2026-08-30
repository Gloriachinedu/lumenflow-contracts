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

// ── Streaming payout export (#821) ───────────────────────────────────────────

/// A single page in a cursor-based streamed payout export.
///
/// Large exports are split into fixed-size pages so the contract never buffers
/// an unbounded collection of records in a single invocation.  Callers iterate
/// by passing `next_cursor` from one call as the `cursor` argument of the next.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutExportPage {
    /// The payment orders in this page.
    pub payments: Vec<PaymentOrder>,
    /// Opaque cursor to pass to the next call to continue the export.
    /// `None` when this is the last page.
    pub next_cursor: Option<String>,
    /// The merchant whose payments this page covers.
    pub merchant: Address,
    /// Total records seen so far (cumulative across pages in this export run).
    pub page_index: u32,
}

/// Describes a summary row in a payout export (one row per completed payment).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PayoutSummaryRow {
    /// Order identifier.
    pub order_id: String,
    /// Payer address.
    pub payer: Address,
    /// Token address used.
    pub token: Address,
    /// Gross payment amount.
    pub amount: i128,
    /// Amount already refunded.
    pub refunded_amount: i128,
    /// Net payout (amount − refunded_amount).
    pub net_payout: i128,
    /// Ledger timestamp of the payment.
    pub paid_at: u64,
}
