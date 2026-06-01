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
    pub note: Option<String>,
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
    Disputed,
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

// ── Dispute ───────────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DisputeOutcome {
    FavorPayer,
    FavorMerchant,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DisputeRecord {
    pub refund_id: String,
    pub payer: Address,
    pub evidence: String,
    pub outcome: Option<DisputeOutcome>,
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
    pub signed_by: Vec<Address>,
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
    /// Aggregate volume of completed payments. Uses saturating arithmetic to avoid
    /// runtime panics when approaching i128::MAX.
    pub total_volume: i128,
    pub total_refunds: u32,
    /// Aggregate volume of executed refunds. Uses saturating arithmetic to avoid
    /// runtime panics when approaching i128::MAX.
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

// ── Subscription ──────────────────────────────────────────────────────────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SubscriptionPlan {
    pub plan_id: String,
    pub merchant: Address,
    pub token: Address,
    pub amount: i128,
    pub interval_secs: u64,
    pub max_cycles: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SubscriptionStatus {
    Active,
    Cancelled,
    Completed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Subscription {
    pub subscription_id: String,
    pub plan_id: String,
    pub subscriber: Address,
    pub cycles_charged: u32,
    pub last_charged_at: u64,
    pub status: SubscriptionStatus,
    pub created_at: u64,
}
