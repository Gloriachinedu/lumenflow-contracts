use soroban_sdk::{contracttype, Address, Env, String, Vec};

use crate::error::PaymentError;
use crate::types::{
    DisputeRecord, EscrowRecord, GlobalStats, Merchant, MerchantStats, MultisigPayment,
    PaymentOrder, PaymentRequest, RefundRecord, Subscription, SubscriptionPlan,
};

// ── TTL / limit constants ─────────────────────────────────────────────────────

/// Minimum refund amount in stroops (default).
pub const MIN_REFUND_AMOUNT: i128 = 100;

/// Maximum number of payment IDs stored per account index.
pub const MAX_PAYMENT_IDS_PER_ACCOUNT: u32 = 10_000;

/// Warning threshold (90% of `MAX_PAYMENT_IDS_PER_ACCOUNT`) at which a
/// `payment_history_near_limit` event is emitted so integrators can react
/// before the hard cap halts further payments for the account.
pub const PAYMENT_HISTORY_WARNING_THRESHOLD: u32 = MAX_PAYMENT_IDS_PER_ACCOUNT * 9 / 10;

// ── Config defaults ───────────────────────────────────────────────────────────

/// Default platform fee: 0 bps (no fee). Admin should set explicitly at deploy time.
pub const DEFAULT_PLATFORM_FEE_BPS: u32 = 0;
/// Maximum allowed platform fee: 10 000 bps = 100 %. Prevents mis-configuration.
pub const MAX_PLATFORM_FEE_BPS: u32 = 10_000;
/// Default refund window: 30 days in seconds.
pub const DEFAULT_REFUND_WINDOW_SECS: u64 = 30 * 24 * 3600;
/// Minimum refund window: 1 hour in seconds. Prevents locking out refunds entirely.
pub const MIN_REFUND_WINDOW_SECS: u64 = 3600;
/// Default payment cleanup period: 30 days in seconds.
pub const DEFAULT_CLEANUP_PERIOD_SECS: u64 = 30 * 24 * 3600;
/// Default large-payment threshold in stroops (10 XLM equivalent).
pub const DEFAULT_LARGE_PAYMENT_THRESHOLD: i128 = 10_000_000;

// Approximate ledger-count equivalents (5-second ledgers):
//   1 year  ≈ 6_307_200 ledgers
//   2 years ≈ 12_614_400 ledgers
pub const MERCHANT_TTL_LEDGERS: u32 = 12_614_400; // 2 years
pub const PAYMENT_TTL_LEDGERS: u32 = 12_614_400;  // 2 years
pub const REFUND_TTL_LEDGERS: u32 = 6_307_200;    // 1 year
pub const MULTISIG_TTL_LEDGERS: u32 = 6_307_200;  // 1 year
pub const SUBSCRIPTION_TTL_LEDGERS: u32 = 12_614_400; // 2 years

// ── Compile-time TTL bound assertions ─────────────────────────────────────────
// Soroban Mainnet maximum persistent entry TTL (3,110,400 ledgers ≈ 6 months).
// Our values intentionally exceed the single-call max because extend_ttl is
// called on every write; the host caps each individual extension at max_entry_ttl.
// These assertions guard against values so large they would be meaningless or
// would indicate a copy-paste error (upper bound: 5 × max ≈ 30 months, comfortably
// above our 2-year maximum but well below any clearly erroneous value).
pub const SOROBAN_MAX_ENTRY_TTL: u32 = 3_110_400;

const _: () = {
    assert!(MERCHANT_TTL_LEDGERS     <= SOROBAN_MAX_ENTRY_TTL * 5, "MERCHANT_TTL_LEDGERS exceeds safe range (5 × max_entry_ttl)");
    assert!(PAYMENT_TTL_LEDGERS      <= SOROBAN_MAX_ENTRY_TTL * 5, "PAYMENT_TTL_LEDGERS exceeds safe range (5 × max_entry_ttl)");
    assert!(REFUND_TTL_LEDGERS       <= SOROBAN_MAX_ENTRY_TTL * 5, "REFUND_TTL_LEDGERS exceeds safe range (5 × max_entry_ttl)");
    assert!(MULTISIG_TTL_LEDGERS     <= SOROBAN_MAX_ENTRY_TTL * 5, "MULTISIG_TTL_LEDGERS exceeds safe range (5 × max_entry_ttl)");
    assert!(SUBSCRIPTION_TTL_LEDGERS <= SOROBAN_MAX_ENTRY_TTL * 5, "SUBSCRIPTION_TTL_LEDGERS exceeds safe range (5 × max_entry_ttl)");
};

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    Paused,
    /// Replaced verbose `CleanupPeriod` — short code `CP`.
    CP,
    GlobalStats,
    Merchant(Address),
    /// Replaced verbose `MerchantList` — short code `ML`.
    ML,
    /// Replaced verbose `MerchantStats` — short code `MS`.
    MS(Address),
    Payment(String),
    /// Replaced verbose `MerchantPayments` — short code `MP`.
    MP(Address),
    /// Replaced verbose `PayerPayments` — short code `PP`.
    PP(Address),
    Refund(String),
    /// Replaced verbose `OrderRefunds` — short code `OR`.
    OR(String),
    Dispute(String),
    Multisig(String),
    PaymentRequest(String),
    /// Replaced verbose `LargePaymentThreshold` — short code `LPT`.
    LPT,
    /// Replaced verbose `AllowedToken` — short code `AT`.
    AT(Address),
    /// Replaced verbose `MultisigExpiryDuration` — short code `MED`.
    MED,
    /// Replaced verbose `MinRefundAmount` — short code `MRA`.
    MRA,
    /// Replaced verbose `PlatformFeeBps` — short code `PFB`.
    PFB,
    /// Replaced verbose `FeeRecipient` — short code `FR`.
    FR,
    /// Replaced verbose `RefundWindow` — short code `RW`.
    RW,
    Nonce(Address),
    MerchantNonce(Address),
    StoredVersion,
    SubscriptionPlan(String),
    Subscription(String),
    SubscriptionReserve(Address, Address),
    /// Global rate-limit cap (max payments per merchant per window).
    RateLimitPerWindow,
    /// Rolling-window counter for a merchant: (merchant, window_start_ledger) → count.
    RateLimitCounter(Address, u32),
    /// Time-locked escrow record keyed by order_id.
    Escrow(String),
    /// Auth failure counter for rate-limiting (Issue #628): (address) → (failure_count, first_fail_ledger).
    AuthFailCount(Address),
    /// Auth lockout expiry (Issue #628): (address) → ledger at which lockout expires.
    AuthLockoutUntil(Address),
}

/// The schema version this binary was compiled against.
/// Bump this constant whenever a `#[contracttype]` struct or enum is changed in
/// a way that is not backwards-compatible (field added without `Option`, variant
/// reordered, type changed, etc.).
pub const CURRENT_STORAGE_VERSION: u32 = 1;

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

// ── Pause ─────────────────────────────────────────────────────────────────────

pub fn get_paused(env: &Env) -> bool {
    env.storage().instance().get(&DataKey::Paused).unwrap_or(false)
}

pub fn set_paused(env: &Env, paused: bool) {
    env.storage().instance().set(&DataKey::Paused, &paused);
}

// ── Cleanup period ────────────────────────────────────────────────────────────

pub fn get_cleanup_period(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::CP)
        .unwrap_or(DEFAULT_CLEANUP_PERIOD_SECS)
}

pub fn set_cleanup_period(env: &Env, period: u64) {
    env.storage()
        .instance()
        .set(&DataKey::CP, &period);
}

// ── Platform fee ──────────────────────────────────────────────────────────────

pub fn get_platform_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::PFB)
        .unwrap_or(DEFAULT_PLATFORM_FEE_BPS)
}

pub fn set_platform_fee_bps(env: &Env, fee_bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::PFB, &fee_bps);
}

pub fn get_fee_recipient(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::FR)
}

pub fn set_fee_recipient(env: &Env, recipient: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::FR, recipient);
}

// ── Refund window ─────────────────────────────────────────────────────────────

pub fn get_refund_window(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::RW)
        .unwrap_or(DEFAULT_REFUND_WINDOW_SECS)
}

pub fn set_refund_window(env: &Env, window_secs: u64) {
    env.storage()
        .instance()
        .set(&DataKey::RW, &window_secs);
}

// ── Suspicious Activity Thresholds ────────────────────────────────────────────

pub fn get_large_payment_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::LPT)
        .unwrap_or(DEFAULT_LARGE_PAYMENT_THRESHOLD)
}

pub fn set_large_payment_threshold(env: &Env, threshold: i128) {
    env.storage()
        .instance()
        .set(&DataKey::LPT, &threshold);
}

pub fn get_min_refund_amount(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::MRA)
        .unwrap_or(MIN_REFUND_AMOUNT)
}

pub fn set_min_refund_amount(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MRA, &amount);
}

// ── Global stats ──────────────────────────────────────────────────────────────

pub fn get_global_stats(env: &Env) -> GlobalStats {
    env.storage()
        .instance()
        .get(&DataKey::GlobalStats)
        .unwrap_or(GlobalStats {
            total_payments: 0,
            total_volume: 0,
            total_refunds: 0,
            total_refund_volume: 0,
            active_merchants: 0,
        })
}

pub fn set_global_stats(env: &Env, stats: &GlobalStats) {
    env.storage().instance().set(&DataKey::GlobalStats, stats);
}

// ── Merchant stats ─────────────────────────────────────────────────────────────

pub fn get_merchant_stats(env: &Env, merchant: &Address) -> MerchantStats {
    env.storage()
        .instance()
        .get(&DataKey::MS(merchant.clone()))
        .unwrap_or(MerchantStats {
            total_payments: 0,
            total_volume: 0,
            total_refunds: 0,
            total_refund_volume: 0,
        })
}

pub fn set_merchant_stats(env: &Env, merchant: &Address, stats: &MerchantStats) {
    env.storage()
        .instance()
        .set(&DataKey::MS(merchant.clone()), stats);
}

// ── Merchant ──────────────────────────────────────────────────────────────────

pub fn get_merchant(env: &Env, address: &Address) -> Option<Merchant> {
    env.storage()
        .persistent()
        .get(&DataKey::Merchant(address.clone()))
}

pub fn set_merchant(env: &Env, merchant: &Merchant) {
    let key = DataKey::Merchant(merchant.address.clone());
    env.storage().persistent().set(&key, merchant);
    // Extend TTL so the merchant profile remains accessible for 2 years from
    // the last write. This prevents silent expiry of active merchant accounts.
    env.storage()
        .persistent()
        .extend_ttl(&key, MERCHANT_TTL_LEDGERS, MERCHANT_TTL_LEDGERS);
}

pub fn get_merchant_list(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::ML)
        .unwrap_or(Vec::new(env))
}

pub fn add_to_merchant_list(env: &Env, address: &Address) {
    let mut list = get_merchant_list(env);
    list.push_back(address.clone());
    env.storage().instance().set(&DataKey::ML, &list);
}

// ── Payment ───────────────────────────────────────────────────────────────────

pub fn get_payment(env: &Env, order_id: &String) -> Option<PaymentOrder> {
    env.storage()
        .persistent()
        .get(&DataKey::Payment(order_id.clone()))
}

pub fn set_payment(env: &Env, payment: &PaymentOrder) {
    let key = DataKey::Payment(payment.order_id.clone());
    env.storage().persistent().set(&key, payment);
    // Extend TTL to 2 years on every write so payment records survive audits,
    // refund windows (30 days), and dispute resolution periods.
    env.storage()
        .persistent()
        .extend_ttl(&key, PAYMENT_TTL_LEDGERS, PAYMENT_TTL_LEDGERS);
}

pub fn remove_payment(env: &Env, order_id: &String) {
    env.storage()
        .persistent()
        .remove(&DataKey::Payment(order_id.clone()));
}

pub fn get_merchant_payment_ids(env: &Env, merchant: &Address) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&DataKey::MP(merchant.clone()))
        .unwrap_or(Vec::new(env))
}

/// Current number of payment IDs indexed for `merchant`.
pub fn get_merchant_payment_count(env: &Env, merchant: &Address) -> u32 {
    get_merchant_payment_ids(env, merchant).len()
}

pub fn add_merchant_payment_id(env: &Env, merchant: &Address, order_id: &String) -> Result<(), PaymentError> {
    let mut ids = get_merchant_payment_ids(env, merchant);
    let old_len = ids.len();
    if old_len >= MAX_PAYMENT_IDS_PER_ACCOUNT {
        return Err(PaymentError::PaymentHistoryLimitExceeded);
    }
    ids.push_back(order_id.clone());
    let new_len = ids.len();
    let key = DataKey::MP(merchant.clone());
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PAYMENT_TTL_LEDGERS, PAYMENT_TTL_LEDGERS);

    if old_len < PAYMENT_HISTORY_WARNING_THRESHOLD && new_len >= PAYMENT_HISTORY_WARNING_THRESHOLD {
        env.events().publish(
            ("lumenflow", "payment_history_near_limit", merchant.clone()),
            (new_len, MAX_PAYMENT_IDS_PER_ACCOUNT),
        );
    }
    Ok(())
}

pub fn get_payer_payment_ids(env: &Env, payer: &Address) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&DataKey::PP(payer.clone()))
        .unwrap_or(Vec::new(env))
}

/// Current number of payment IDs indexed for `payer`.
pub fn get_payer_payment_count(env: &Env, payer: &Address) -> u32 {
    get_payer_payment_ids(env, payer).len()
}

pub fn add_payer_payment_id(env: &Env, payer: &Address, order_id: &String) -> Result<(), PaymentError> {
    let mut ids = get_payer_payment_ids(env, payer);
    let old_len = ids.len();
    if old_len >= MAX_PAYMENT_IDS_PER_ACCOUNT {
        return Err(PaymentError::PaymentHistoryLimitExceeded);
    }
    ids.push_back(order_id.clone());
    let new_len = ids.len();
    let key = DataKey::PP(payer.clone());
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PAYMENT_TTL_LEDGERS, PAYMENT_TTL_LEDGERS);

    if old_len < PAYMENT_HISTORY_WARNING_THRESHOLD && new_len >= PAYMENT_HISTORY_WARNING_THRESHOLD {
        env.events().publish(
            ("lumenflow", "payment_history_near_limit", payer.clone()),
            (new_len, MAX_PAYMENT_IDS_PER_ACCOUNT),
        );
    }
    Ok(())
}

// ── Refund ────────────────────────────────────────────────────────────────────

pub fn get_refund(env: &Env, refund_id: &String) -> Option<RefundRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::Refund(refund_id.clone()))
}

pub fn set_refund(env: &Env, refund: &RefundRecord) {
    let key = DataKey::Refund(refund.refund_id.clone());
    env.storage().persistent().set(&key, refund);
    // Extend TTL to 1 year; the full refund lifecycle (initiate → approve →
    // execute) completes well within this window.
    env.storage()
        .persistent()
        .extend_ttl(&key, REFUND_TTL_LEDGERS, REFUND_TTL_LEDGERS);
}

pub fn get_order_refund_ids(env: &Env, order_id: &String) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&DataKey::OR(order_id.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn add_order_refund_id(env: &Env, order_id: &String, refund_id: &String) {
    let mut ids = get_order_refund_ids(env, order_id);
    ids.push_back(refund_id.clone());
    env.storage()
        .persistent()
        .set(&DataKey::OR(order_id.clone()), &ids);
}

// ── Dispute ───────────────────────────────────────────────────────────────────

pub fn get_dispute(env: &Env, dispute_id: &String) -> Option<DisputeRecord> {
    env.storage().persistent().get(&DataKey::Dispute(dispute_id.clone()))
}

pub fn set_dispute(env: &Env, dispute: &DisputeRecord) {
    let key = DataKey::Dispute(dispute.dispute_id.clone());
    env.storage().persistent().set(&key, dispute);
    // Extend TTL to 1 year so dispute records outlive the refund window.
    env.storage()
        .persistent()
        .extend_ttl(&key, REFUND_TTL_LEDGERS, REFUND_TTL_LEDGERS);
}

// ── Multisig ──────────────────────────────────────────────────────────────────

pub fn get_multisig(env: &Env, payment_id: &String) -> Option<MultisigPayment> {
    env.storage()
        .persistent()
        .get(&DataKey::Multisig(payment_id.clone()))
}

pub fn set_multisig(env: &Env, ms: &MultisigPayment) {
    let key = DataKey::Multisig(ms.payment_id.clone());
    env.storage().persistent().set(&key, ms);
    // Extend TTL to 1 year; multisig payments are typically executed quickly
    // but the record is kept for history and potential refund initiation.
    env.storage()
        .persistent()
        .extend_ttl(&key, MULTISIG_TTL_LEDGERS, MULTISIG_TTL_LEDGERS);
}

pub fn remove_multisig(env: &Env, payment_id: &String) {
    env.storage()
        .persistent()
        .remove(&DataKey::Multisig(payment_id.clone()));
}

// ── Payment Request ───────────────────────────────────────────────────────────

pub fn get_payment_request(env: &Env, request_id: &String) -> Option<PaymentRequest> {
    env.storage()
        .temporary()
        .get(&DataKey::PaymentRequest(request_id.clone()))
}

pub fn set_payment_request(env: &Env, pr: &PaymentRequest) {
    env.storage()
        .temporary()
        .set(&DataKey::PaymentRequest(pr.request_id.clone()), pr);
}

pub fn remove_payment_request(env: &Env, request_id: &String) {
    env.storage()
        .temporary()
        .remove(&DataKey::PaymentRequest(request_id.clone()));
}

// ── Nonce (replay protection) ─────────────────────────────────────────────────

/// Return the current (next expected) nonce for `payer`. Starts at 0.
pub fn get_nonce(env: &Env, payer: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::Nonce(payer.clone()))
        .unwrap_or(0u64)
}

/// Increment the stored nonce for `payer` by 1.
///
/// Must be called *before* any external token transfers to follow the
/// checks-effects-interactions pattern and prevent reentrancy-style replay.
pub fn increment_nonce(env: &Env, payer: &Address) {
    let current = get_nonce(env, payer);
    let key = DataKey::Nonce(payer.clone());
    env.storage()
        .persistent()
        .set(&key, &current.saturating_add(1));
    // Extend TTL alongside payment records so the nonce stays live as long
    // as the account is making payments (2-year window, same as payments).
    env.storage()
        .persistent()
        .extend_ttl(&key, PAYMENT_TTL_LEDGERS, PAYMENT_TTL_LEDGERS);
}

// ── Merchant Nonce (replay protection per merchant) ───────────────────────────

/// Return the current nonce for `merchant`. Starts at 0.
///
/// Callers should pass `nonce = get_merchant_nonce(...) + 1` when constructing
/// a payment so that the contract can verify the signature includes a fresh,
/// never-reused value.
pub fn get_merchant_nonce(env: &Env, merchant: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantNonce(merchant.clone()))
        .unwrap_or(0u64)
}

/// Increment the stored nonce for `merchant` by 1.
///
/// Must be called after successful signature verification but before any
/// external token transfers (checks-effects-interactions pattern).
pub fn increment_merchant_nonce(env: &Env, merchant: &Address) {
    let current = get_merchant_nonce(env, merchant);
    let key = DataKey::MerchantNonce(merchant.clone());
    env.storage()
        .persistent()
        .set(&key, &current.saturating_add(1));
    env.storage()
        .persistent()
        .extend_ttl(&key, PAYMENT_TTL_LEDGERS, PAYMENT_TTL_LEDGERS);
}

// ── Allowed Tokens ────────────────────────────────────────────────────────────

pub fn is_token_allowed(env: &Env, token: &Address) -> bool {
    env.storage()
        .instance()
        .has(&DataKey::AT(token.clone()))
}

pub fn set_token_allowed(env: &Env, token: &Address, allowed: bool) {
    if allowed {
        env.storage()
            .instance()
            .set(&DataKey::AT(token.clone()), &());
    } else {
        env.storage()
            .instance()
            .remove(&DataKey::AT(token.clone()));
    }
}

// ── Multisig Expiry ───────────────────────────────────────────────────────────

pub const DEFAULT_MULTISIG_EXPIRY: u64 = 7 * 24 * 3600; // 7 days

pub fn get_multisig_expiry_duration(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::MED)
        .unwrap_or(DEFAULT_MULTISIG_EXPIRY)
}

pub fn set_multisig_expiry_duration(env: &Env, duration: u64) {
    env.storage()
        .instance()
        .set(&DataKey::MED, &duration);
}

// -- Subscriptions -------------------------------------------------------------

pub fn get_subscription_plan(env: &Env, plan_id: &String) -> Option<SubscriptionPlan> {
    env.storage()
        .persistent()
        .get(&DataKey::SP(plan_id.clone()))
}

pub fn set_subscription_plan(env: &Env, plan: &SubscriptionPlan) {
    let key = DataKey::SP(plan.plan_id.clone());
    env.storage().persistent().set(&key, plan);
    env.storage()
        .persistent()
        .extend_ttl(&key, SUBSCRIPTION_TTL_LEDGERS, SUBSCRIPTION_TTL_LEDGERS);
}

pub fn get_subscription(env: &Env, subscription_id: &String) -> Option<Subscription> {
    env.storage()
        .persistent()
        .get(&DataKey::Sub(subscription_id.clone()))
}

pub fn set_subscription(env: &Env, sub: &Subscription) {
    let key = DataKey::Sub(sub.subscription_id.clone());
    env.storage().persistent().set(&key, sub);
    // Extend TTL on every write so an actively charged subscription never
    // silently expires between billing cycles.
    env.storage()
        .persistent()
        .extend_ttl(&key, SUBSCRIPTION_TTL_LEDGERS, SUBSCRIPTION_TTL_LEDGERS);
}

/// Total amount still chargeable across `subscriber`'s active subscriptions in
/// `token`; the token allowance granted to the contract must cover this sum.
pub fn get_subscription_reserve(env: &Env, subscriber: &Address, token: &Address) -> i128 {
    env.storage()
        .persistent()
        .get(&DataKey::SR(
            subscriber.clone(),
            token.clone(),
        ))
        .unwrap_or(0)
}

pub fn set_subscription_reserve(env: &Env, subscriber: &Address, token: &Address, amount: i128) {
    let key = DataKey::SR(subscriber.clone(), token.clone());
    if amount <= 0 {
        env.storage().persistent().remove(&key);
    } else {
        env.storage().persistent().set(&key, &amount);
        env.storage()
            .persistent()
            .extend_ttl(&key, SUBSCRIPTION_TTL_LEDGERS, SUBSCRIPTION_TTL_LEDGERS);
    }
}

// ── Escrow ────────────────────────────────────────────────────────────────────

/// TTL for escrow records — 1 year; escrows are expected to resolve well within this window.
pub const ESCROW_TTL_LEDGERS: u32 = 6_307_200;

const _ESCROW_TTL_CHECK: () = assert!(
    ESCROW_TTL_LEDGERS <= SOROBAN_MAX_ENTRY_TTL * 5,
    "ESCROW_TTL_LEDGERS exceeds safe range (5 × max_entry_ttl)"
);

pub fn get_escrow(env: &Env, order_id: &String) -> Option<EscrowRecord> {
    env.storage()
        .persistent()
        .get(&DataKey::Escrow(order_id.clone()))
}

pub fn set_escrow(env: &Env, escrow: &EscrowRecord) {
    let key = DataKey::Escrow(escrow.order_id.clone());
    env.storage().persistent().set(&key, escrow);
    env.storage()
        .persistent()
        .extend_ttl(&key, ESCROW_TTL_LEDGERS, ESCROW_TTL_LEDGERS);
}

// ── Rate limiting ─────────────────────────────────────────────────────────────

/// Default max payments per merchant per rate-limit window (300 ledgers).
pub const DEFAULT_RATE_LIMIT_PER_WINDOW: u32 = 100;
/// Window size in ledgers (300 ledgers ≈ 25 minutes at 5 s/ledger).
pub const RATE_LIMIT_WINDOW_LEDGERS: u32 = 300;
/// TTL for rate-limit counters — kept alive for 2 windows so a counter is not
/// silently dropped mid-window.
pub const RATE_LIMIT_TTL_LEDGERS: u32 = 600;

pub fn get_rate_limit_per_window(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::RateLimitPerWindow)
        .unwrap_or(DEFAULT_RATE_LIMIT_PER_WINDOW)
}

pub fn set_rate_limit_per_window(env: &Env, limit: u32) {
    env.storage()
        .instance()
        .set(&DataKey::RateLimitPerWindow, &limit);
}

/// Returns the ledger number of the start of the current window.
pub fn current_window_start(env: &Env) -> u32 {
    let seq = env.ledger().sequence();
    (seq / RATE_LIMIT_WINDOW_LEDGERS) * RATE_LIMIT_WINDOW_LEDGERS
}

pub fn get_rate_limit_counter(env: &Env, merchant: &Address, window_start: u32) -> u32 {
    env.storage()
        .temporary()
        .get(&DataKey::RateLimitCounter(merchant.clone(), window_start))
        .unwrap_or(0u32)
}

pub fn increment_rate_limit_counter(env: &Env, merchant: &Address, window_start: u32) {
    let count = get_rate_limit_counter(env, merchant, window_start) + 1;
    let key = DataKey::RateLimitCounter(merchant.clone(), window_start);
    env.storage().temporary().set(&key, &count);
    // Extend TTL so the counter outlives its window by a safe margin.
    env.storage()
        .temporary()
        .extend_ttl(&key, RATE_LIMIT_TTL_LEDGERS, RATE_LIMIT_TTL_LEDGERS);
}

// ── Contract version ──────────────────────────────────────────────────────────

/// Retrieve the on-chain stored contract version string, if set.
pub fn get_stored_version(env: &Env) -> Option<String> {
    env.storage().instance().get(&DataKey::SV)
}

/// Persist the contract version string on-chain.
pub fn set_stored_version(env: &Env, version: &String) {
    env.storage()
        .instance()
        .set(&DataKey::SV, version);
}

// ── Emergency pause timelock ──────────────────────────────────────────────────

/// Retrieve the pause reason string, if set.
pub fn get_pause_reason(env: &Env) -> Option<String> {
    env.storage().instance().get(&DataKey::PR)
}

/// Persist the pause reason string on-chain.
pub fn set_pause_reason(env: &Env, reason: &String) {
    env.storage().instance().set(&DataKey::PR, reason);
}

/// Clear the pause reason from storage.
pub fn clear_pause_reason(env: &Env) {
    env.storage().instance().remove(&DataKey::PR);
}

/// Retrieve the timestamp (seconds) when the unpause timelock expires, if set.
pub fn get_unpause_lock_until(env: &Env) -> Option<u64> {
    env.storage().instance().get(&DataKey::ULU)
}

/// Persist the unpause timelock expiry timestamp.
pub fn set_unpause_lock_until(env: &Env, timestamp: u64) {
    env.storage()
        .instance()
        .set(&DataKey::ULU, &timestamp);
}

/// Clear the unpause timelock from storage.
pub fn clear_unpause_lock_until(env: &Env) {
    env.storage().instance().remove(&DataKey::ULU);
}

/// Retrieve the list of authorized pause guardians.
pub fn get_pause_guardians(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::PG)
        .unwrap_or(Vec::new(env))
}

/// Persist the list of authorized pause guardians.
pub fn set_pause_guardians(env: &Env, guardians: &Vec<Address>) {
    env.storage()
        .instance()
        .set(&DataKey::PG, guardians);
}

/// Retrieve the list of guardians who have approved the current early unpause.
pub fn get_early_unpause_approvals(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&DataKey::EPA)
        .unwrap_or(Vec::new(env))
}

/// Persist the list of guardians who have approved the current early unpause.
pub fn set_early_unpause_approvals(env: &Env, approvals: &Vec<Address>) {
    env.storage()
        .instance()
        .set(&DataKey::EPA, approvals);
}

/// Clear the early unpause approval list from storage.
pub fn clear_early_unpause_approvals(env: &Env) {
    env.storage()
        .instance()
        .remove(&DataKey::EPA);
}

// ── Storage key migration (v1 → v2) ──────────────────────────────────────────
//
// In v1 the `DataKey` variants used verbose names serialised as long XDR
// symbols (e.g. `MerchantPayments`, `LargePaymentThreshold`).  In v2 each
// key was shortened to a 2–4-character code (e.g. `MP`, `LPT`) to reduce
// per-ledger-entry overhead.
//
// `migrate_storage_keys` is called once during a contract upgrade.  For each
// **instance-storage** key that may have been written by v1 code it reads the
// value under the old name and, if present, writes it under the new name and
// removes the old entry.  Persistent and temporary keys (Payment, Merchant,
// Refund, …) are keyed by dynamic arguments so they are unaffected — the
// migration only covers the configuration/singleton instance keys.

/// One-time migration that remaps verbose v1 instance-storage keys to the
/// compact v2 short codes introduced in storage key optimisation #566.
///
/// Safe to call multiple times: if the old key no longer exists (already
/// migrated) the function is a no-op for that entry.
///
/// # Old → New mapping (instance storage only)
///
/// | Old variant           | New short code |
/// |-----------------------|----------------|
/// | `CleanupPeriod`       | `CP`           |
/// | `PlatformFeeBps`      | `PFB`          |
/// | `FeeRecipient`        | `FR`           |
/// | `RefundWindow`        | `RW`           |
/// | `LargePaymentThreshold` | `LPT`        |
/// | `MinRefundAmount`     | `MRA`          |
/// | `MultisigExpiryDuration` | `MED`       |
/// | `StoredVersion`       | `SV`           |
/// | `MerchantList`        | `ML`           |
pub fn migrate_storage_keys(env: &Env) {
    // Helper: migrate a single instance key from an old #[contracttype] symbol
    // to the new short code.  We can't use the enum variants for the old names
    // because they no longer exist in the v2 enum.  Instead we construct the
    // raw symbol keys inline using soroban_sdk::Symbol.

    use soroban_sdk::Symbol;

    macro_rules! migrate_instance {
        ($old_sym:expr, $new_key:expr, $ty:ty) => {{
            let old_key = Symbol::new(env, $old_sym);
            let store = env.storage().instance();
            if let Some(val) = store.get::<_, $ty>(&old_key) {
                store.set(&$new_key, &val);
                store.remove(&old_key);
            }
        }};
    }

    migrate_instance!("CleanupPeriod",          DataKey::CP,  u64);
    migrate_instance!("PlatformFeeBps",         DataKey::PFB, u32);
    migrate_instance!("RefundWindow",           DataKey::RW,  u64);
    migrate_instance!("LargePaymentThreshold",  DataKey::LPT, i128);
    migrate_instance!("MinRefundAmount",        DataKey::MRA, i128);
    migrate_instance!("MultisigExpiryDuration", DataKey::MED, u64);
    migrate_instance!("StoredVersion",          DataKey::SV,  soroban_sdk::String);
    // MerchantList migration — value type is Vec<Address>
    {
        let old_key = Symbol::new(env, "MerchantList");
        let store = env.storage().instance();
        if let Some(val) = store.get::<_, Vec<Address>>(&old_key) {
            store.set(&DataKey::ML, &val);
            store.remove(&old_key);
        }
    }
    // FeeRecipient migration — value type is Address
    {
        let old_key = Symbol::new(env, "FeeRecipient");
        let store = env.storage().instance();
        if let Some(val) = store.get::<_, Address>(&old_key) {
            store.set(&DataKey::FR, &val);
            store.remove(&old_key);
        }
    }
}

// ── GDPR Data Deletion Requests ───────────────────────────────────────────────

/// Returns the Unix timestamp (seconds) at which the merchant submitted their
/// data-deletion request, or `None` if no pending request exists.
pub fn get_deletion_request(env: &Env, merchant: &Address) -> Option<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::DeletionRequest(merchant.clone()))
}

/// Records a pending data-deletion request for the given merchant address.
pub fn set_deletion_request(env: &Env, merchant: &Address, requested_at: u64) {
    let key = DataKey::DeletionRequest(merchant.clone());
    env.storage().persistent().set(&key, &requested_at);
    // Keep for up to 1 year so the admin can process it well within the 30-day window.
    env.storage()
        .persistent()
        .extend_ttl(&key, REFUND_TTL_LEDGERS, REFUND_TTL_LEDGERS);
}

/// Removes the pending data-deletion request once it has been processed.
pub fn remove_deletion_request(env: &Env, merchant: &Address) {
    env.storage()
        .persistent()
        .remove(&DataKey::DeletionRequest(merchant.clone()));
}

// ── Referral fee ──────────────────────────────────────────────────────────────

/// Global referral reward in basis points (e.g. 50 = 0.5 % fee reduction).
/// Returns 0 if not configured by admin.
pub fn get_referral_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::ReferralFeeBps)
        .unwrap_or(0u32)
}

/// Persist the global referral fee reward (basis points). Admin only — caller
/// is responsible for authorization before invoking this function.
pub fn set_referral_fee_bps(env: &Env, fee_bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::ReferralFeeBps, &fee_bps);
}

// ── Auth failure rate limiting (Issue #628) ───────────────────────────────────
//
// To prevent brute-force probing of admin-restricted functions, a per-address
// failure counter is maintained. After AUTH_MAX_FAILURES consecutive failures
// within AUTH_FAILURE_WINDOW_LEDGERS, the address is temporarily locked out for
// AUTH_LOCKOUT_LEDGERS.
//
// Ledger-time approximations (5 s/ledger):
//   100 ledgers  ≈  8.3 minutes  (failure counting window)
//   1000 ledgers ≈ 83 minutes    (lockout duration)

/// Maximum auth failures within AUTH_FAILURE_WINDOW_LEDGERS before lockout.
pub const AUTH_MAX_FAILURES: u32 = 10;
/// Sliding-window width in ledgers for failure counting.
pub const AUTH_FAILURE_WINDOW_LEDGERS: u32 = 100;
/// Lockout duration in ledgers once the threshold is exceeded.
pub const AUTH_LOCKOUT_LEDGERS: u32 = 1_000;
/// TTL for failure counter entries — kept for 2× the lockout duration.
pub const AUTH_TTL_LEDGERS: u32 = 2_000;

/// (failure_count, window_start_ledger) stored per address.
#[derive(Clone, Copy)]
pub struct AuthFailRecord {
    pub failure_count: u32,
    pub window_start: u32,
}

/// Returns the current auth failure record for `address`, or a zeroed record.
pub fn get_auth_fail_count(env: &Env, address: &Address) -> (u32, u32) {
    env.storage()
        .temporary()
        .get::<_, (u32, u32)>(&DataKey::AuthFailCount(address.clone()))
        .unwrap_or((0u32, 0u32))
}

/// Persists the auth failure record `(count, window_start)` for `address`.
fn set_auth_fail_count(env: &Env, address: &Address, count: u32, window_start: u32) {
    let key = DataKey::AuthFailCount(address.clone());
    env.storage().temporary().set(&key, &(count, window_start));
    env.storage()
        .temporary()
        .extend_ttl(&key, AUTH_TTL_LEDGERS, AUTH_TTL_LEDGERS);
}

/// Clears the auth failure counter for `address` (called on successful auth or after reset).
pub fn clear_auth_fail_count(env: &Env, address: &Address) {
    env.storage()
        .temporary()
        .remove(&DataKey::AuthFailCount(address.clone()));
}

/// Returns the lockout-expiry ledger for `address`, or `0` if not locked out.
pub fn get_auth_lockout_until(env: &Env, address: &Address) -> u32 {
    env.storage()
        .temporary()
        .get::<_, u32>(&DataKey::AuthLockoutUntil(address.clone()))
        .unwrap_or(0u32)
}

/// Sets the lockout-expiry ledger for `address` to
/// `current_ledger + AUTH_LOCKOUT_LEDGERS`.
fn set_auth_lockout(env: &Env, address: &Address) {
    let until = env.ledger().sequence() + AUTH_LOCKOUT_LEDGERS;
    let key = DataKey::AuthLockoutUntil(address.clone());
    env.storage().temporary().set(&key, &until);
    env.storage()
        .temporary()
        .extend_ttl(&key, AUTH_TTL_LEDGERS, AUTH_TTL_LEDGERS);
}

/// Clears the lockout for `address` (used by `reset_auth_lockout`).
pub fn clear_auth_lockout(env: &Env, address: &Address) {
    env.storage()
        .temporary()
        .remove(&DataKey::AuthLockoutUntil(address.clone()));
    clear_auth_fail_count(env, address);
}

/// Returns `true` if `address` is currently locked out.
pub fn is_auth_locked_out(env: &Env, address: &Address) -> bool {
    let until = get_auth_lockout_until(env, address);
    until > 0 && env.ledger().sequence() < until
}

/// Records one auth failure for `address`. Increments the counter within the
/// current window and returns `true` if this failure triggers a lockout (i.e.
/// the count just hit AUTH_MAX_FAILURES).
///
/// Window resets if the most recent failure is outside AUTH_FAILURE_WINDOW_LEDGERS.
pub fn record_auth_failure(env: &Env, address: &Address) -> bool {
    let seq = env.ledger().sequence();
    let (count, window_start) = get_auth_fail_count(env, address);

    let (new_count, new_window) = if window_start == 0 || seq >= window_start + AUTH_FAILURE_WINDOW_LEDGERS {
        // First failure or window expired — start a fresh window.
        (1u32, seq)
    } else {
        // Still within the current window.
        (count + 1, window_start)
    };

    set_auth_fail_count(env, address, new_count, new_window);

    if new_count >= AUTH_MAX_FAILURES {
        set_auth_lockout(env, address);
        true
    } else {
        false
    }
}

// ── Allowed Issuers ───────────────────────────────────────────────────────────

/// Returns true if the issuer has been registered as an approved token issuer.
pub fn is_issuer_allowed(env: &Env, issuer: &Address) -> bool {
    env.storage().instance().has(&DataKey::AllowedIssuer(issuer.clone()))
}

/// Register or deregister an issuer address.
pub fn set_issuer_allowed(env: &Env, issuer: &Address, allowed: bool) {
    if allowed {
        env.storage().instance().set(&DataKey::AllowedIssuer(issuer.clone()), &());
    } else {
        env.storage().instance().remove(&DataKey::AllowedIssuer(issuer.clone()));
    }
}

// ── Storage version / upgrade compatibility ───────────────────────────────────

/// Return the schema version written into storage, or 0 if it has never been
/// written (i.e. the contract was deployed before versioning was introduced).
pub fn get_storage_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::StorageVersion)
        .unwrap_or(0)
}

/// Persist the supplied schema version.
pub fn set_storage_version(env: &Env, version: u32) {
    env.storage()
        .instance()
        .set(&DataKey::StorageVersion, &version);
}
