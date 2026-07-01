use soroban_sdk::{contracttype, Address, Env, String, Vec};

use crate::error::PaymentError;
use crate::types::{
    DisputeRecord, GlobalStats, Merchant, MerchantStats, MultisigPayment, PaymentOrder,
    PaymentRequest, RefundRecord,
};

// ── TTL / limit constants ─────────────────────────────────────────────────────

/// Minimum refund amount in stroops (default).
pub const MIN_REFUND_AMOUNT: i128 = 100;

/// Maximum number of payment IDs stored per account index.
pub const MAX_PAYMENT_IDS_PER_ACCOUNT: u32 = 10_000;

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

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    Paused,
    CleanupPeriod,
    GlobalStats,
    Merchant(Address),
    MerchantList,
    MerchantStats(Address),
    Payment(String),
    MerchantPayments(Address),
    PayerPayments(Address),
    Refund(String),
    OrderRefunds(String),
    Dispute(String),
    Multisig(String),
    PaymentRequest(String),
    LargePaymentThreshold,
    AllowedToken(Address),
    MultisigExpiryDuration,
    MinRefundAmount,
    PlatformFeeBps,
    FeeRecipient,
    RefundWindow,
    Nonce(Address),
}

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
        .get(&DataKey::CleanupPeriod)
        .unwrap_or(DEFAULT_CLEANUP_PERIOD_SECS)
}

pub fn set_cleanup_period(env: &Env, period: u64) {
    env.storage()
        .instance()
        .set(&DataKey::CleanupPeriod, &period);
}

// ── Platform fee ──────────────────────────────────────────────────────────────

pub fn get_platform_fee_bps(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::PlatformFeeBps)
        .unwrap_or(DEFAULT_PLATFORM_FEE_BPS)
}

pub fn set_platform_fee_bps(env: &Env, fee_bps: u32) {
    env.storage()
        .instance()
        .set(&DataKey::PlatformFeeBps, &fee_bps);
}

pub fn get_fee_recipient(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::FeeRecipient)
}

pub fn set_fee_recipient(env: &Env, recipient: &Address) {
    env.storage()
        .instance()
        .set(&DataKey::FeeRecipient, recipient);
}

// ── Refund window ─────────────────────────────────────────────────────────────

pub fn get_refund_window(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::RefundWindow)
        .unwrap_or(DEFAULT_REFUND_WINDOW_SECS)
}

pub fn set_refund_window(env: &Env, window_secs: u64) {
    env.storage()
        .instance()
        .set(&DataKey::RefundWindow, &window_secs);
}

// ── Suspicious Activity Thresholds ────────────────────────────────────────────

pub fn get_large_payment_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::LargePaymentThreshold)
        .unwrap_or(DEFAULT_LARGE_PAYMENT_THRESHOLD)
}

pub fn set_large_payment_threshold(env: &Env, threshold: i128) {
    env.storage()
        .instance()
        .set(&DataKey::LargePaymentThreshold, &threshold);
}

pub fn get_min_refund_amount(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::MinRefundAmount)
        .unwrap_or(MIN_REFUND_AMOUNT)
}

pub fn set_min_refund_amount(env: &Env, amount: i128) {
    env.storage()
        .instance()
        .set(&DataKey::MinRefundAmount, &amount);
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
        .get(&DataKey::MerchantStats(merchant.clone()))
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
        .set(&DataKey::MerchantStats(merchant.clone()), stats);
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
        .get(&DataKey::MerchantList)
        .unwrap_or(Vec::new(env))
}

pub fn add_to_merchant_list(env: &Env, address: &Address) {
    let mut list = get_merchant_list(env);
    list.push_back(address.clone());
    env.storage().instance().set(&DataKey::MerchantList, &list);
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
        .get(&DataKey::MerchantPayments(merchant.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn add_merchant_payment_id(env: &Env, merchant: &Address, order_id: &String) -> Result<(), PaymentError> {
    let mut ids = get_merchant_payment_ids(env, merchant);
    if ids.len() >= MAX_PAYMENT_IDS_PER_ACCOUNT {
        return Err(PaymentError::PaymentHistoryLimitExceeded);
    }
    ids.push_back(order_id.clone());
    let key = DataKey::MerchantPayments(merchant.clone());
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PAYMENT_TTL_LEDGERS, PAYMENT_TTL_LEDGERS);
    Ok(())
}

pub fn get_payer_payment_ids(env: &Env, payer: &Address) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&DataKey::PayerPayments(payer.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn add_payer_payment_id(env: &Env, payer: &Address, order_id: &String) -> Result<(), PaymentError> {
    let mut ids = get_payer_payment_ids(env, payer);
    if ids.len() >= MAX_PAYMENT_IDS_PER_ACCOUNT {
        return Err(PaymentError::PaymentHistoryLimitExceeded);
    }
    ids.push_back(order_id.clone());
    let key = DataKey::PayerPayments(payer.clone());
    env.storage().persistent().set(&key, &ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, PAYMENT_TTL_LEDGERS, PAYMENT_TTL_LEDGERS);
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
        .get(&DataKey::OrderRefunds(order_id.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn add_order_refund_id(env: &Env, order_id: &String, refund_id: &String) {
    let mut ids = get_order_refund_ids(env, order_id);
    ids.push_back(refund_id.clone());
    env.storage()
        .persistent()
        .set(&DataKey::OrderRefunds(order_id.clone()), &ids);
}

// ── Dispute ───────────────────────────────────────────────────────────────────

pub fn get_dispute(env: &Env, refund_id: &String) -> Option<DisputeRecord> {
    env.storage().persistent().get(&DataKey::Dispute(refund_id.clone()))
}

pub fn set_dispute(env: &Env, dispute: &DisputeRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::Dispute(dispute.refund_id.clone()), dispute);
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

// ── Allowed Tokens ────────────────────────────────────────────────────────────

pub fn is_token_allowed(env: &Env, token: &Address) -> bool {
    env.storage()
        .instance()
        .has(&DataKey::AllowedToken(token.clone()))
}

pub fn set_token_allowed(env: &Env, token: &Address, allowed: bool) {
    if allowed {
        env.storage()
            .instance()
            .set(&DataKey::AllowedToken(token.clone()), &());
    } else {
        env.storage()
            .instance()
            .remove(&DataKey::AllowedToken(token.clone()));
    }
}

// ── Multisig Expiry ───────────────────────────────────────────────────────────

pub const DEFAULT_MULTISIG_EXPIRY: u64 = 7 * 24 * 3600; // 7 days

pub fn get_multisig_expiry_duration(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::MultisigExpiryDuration)
        .unwrap_or(DEFAULT_MULTISIG_EXPIRY)
}

pub fn set_multisig_expiry_duration(env: &Env, duration: u64) {
    env.storage()
        .instance()
        .set(&DataKey::MultisigExpiryDuration, &duration);
}
