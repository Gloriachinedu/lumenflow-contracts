use soroban_sdk::{contracttype, Address, Env, String, Vec};

use crate::{error::PaymentError, types::{GlobalStats, Merchant, MultisigPayment, PaymentOrder, PaymentRequest, RefundRecord, SubscriptionPlan, Subscription}};

/// Maximum number of payment IDs stored in the merchant or payer history index.
/// This cap bounds Soroban persistent storage growth and limits excessive index
/// reads/writes during history queries.
pub const MAX_PAYMENT_IDS_PER_ACCOUNT: u32 = 1000;

// ── Storage keys ──────────────────────────────────────────────────────────────

#[contracttype]
pub enum DataKey {
    Admin,
    CleanupPeriod,
    GlobalStats,
    Merchant(Address),
    MerchantList,
    Payment(String),
    MerchantPayments(Address),
    PayerPayments(Address),
    Refund(String),
    Multisig(String),
    PaymentRequest(String),
    LargePaymentThreshold,
    MaxRefundsPerOrder,
    OrderRefundCount(String),
}

// ── Admin ─────────────────────────────────────────────────────────────────────

pub fn get_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::Admin)
}

pub fn set_admin(env: &Env, admin: &Address) {
    env.storage().instance().set(&DataKey::Admin, admin);
}

// ── Cleanup period ────────────────────────────────────────────────────────────

pub fn get_cleanup_period(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::CleanupPeriod)
        .unwrap_or(30 * 24 * 3600) // 30 days default
}

pub fn set_cleanup_period(env: &Env, period: u64) {
    env.storage().instance().set(&DataKey::CleanupPeriod, &period);
}

// ── Suspicious Activity Thresholds ────────────────────────────────────────────

pub fn get_large_payment_threshold(env: &Env) -> i128 {
    env.storage()
        .instance()
        .get(&DataKey::LargePaymentThreshold)
        .unwrap_or(10_000_000) // Default 10M units
}

pub fn set_large_payment_threshold(env: &Env, threshold: i128) {
    env.storage()
        .instance()
        .set(&DataKey::LargePaymentThreshold, &threshold);
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

// ── Merchant ──────────────────────────────────────────────────────────────────

pub fn get_merchant(env: &Env, address: &Address) -> Option<Merchant> {
    env.storage().persistent().get(&DataKey::Merchant(address.clone()))
}

pub fn set_merchant(env: &Env, merchant: &Merchant) {
    env.storage()
        .persistent()
        .set(&DataKey::Merchant(merchant.address.clone()), merchant);
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
    env.storage().persistent().get(&DataKey::Payment(order_id.clone()))
}

pub fn set_payment(env: &Env, payment: &PaymentOrder) {
    env.storage()
        .persistent()
        .set(&DataKey::Payment(payment.order_id.clone()), payment);
}

pub fn remove_payment(env: &Env, order_id: &String) {
    env.storage().persistent().remove(&DataKey::Payment(order_id.clone()));
}

pub fn get_merchant_payment_ids(env: &Env, merchant: &Address) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantPayments(merchant.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn add_merchant_payment_id(env: &Env, merchant: &Address, order_id: &String) -> Result<(), PaymentError> {
    let mut ids = get_merchant_payment_ids(env, merchant);
    if ids.len() >= MAX_PAYMENT_IDS_PER_ACCOUNT as usize {
        return Err(PaymentError::PaymentHistoryLimitExceeded);
    }
    ids.push_back(order_id.clone());
    env.storage()
        .persistent()
        .set(&DataKey::MerchantPayments(merchant.clone()), &ids);
    Ok(())
}

pub fn remove_merchant_payment_id(env: &Env, merchant: &Address, order_id: &String) {
    let ids = get_merchant_payment_ids(env, merchant);
    let mut new_ids: Vec<String> = Vec::new(env);
    for id in ids.iter() {
        if id != *order_id {
            new_ids.push_back(id);
        }
    }
    env.storage()
        .persistent()
        .set(&DataKey::MerchantPayments(merchant.clone()), &new_ids);
}

pub fn get_payer_payment_ids(env: &Env, payer: &Address) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&DataKey::PayerPayments(payer.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn add_payer_payment_id(env: &Env, payer: &Address, order_id: &String) -> Result<(), PaymentError> {
    let mut ids = get_payer_payment_ids(env, payer);
    if ids.len() >= MAX_PAYMENT_IDS_PER_ACCOUNT as usize {
        return Err(PaymentError::PaymentHistoryLimitExceeded);
    }
    ids.push_back(order_id.clone());
    env.storage()
        .persistent()
        .set(&DataKey::PayerPayments(payer.clone()), &ids);
    Ok(())
}

pub fn remove_payer_payment_id(env: &Env, payer: &Address, order_id: &String) {
    let ids = get_payer_payment_ids(env, payer);
    let mut new_ids: Vec<String> = Vec::new(env);
    for id in ids.iter() {
        if id != *order_id {
            new_ids.push_back(id);
        }
    }
    env.storage()
        .persistent()
        .set(&DataKey::PayerPayments(payer.clone()), &new_ids);
}

// ── Refund ────────────────────────────────────────────────────────────────────

pub fn get_refund(env: &Env, refund_id: &String) -> Option<RefundRecord> {
    env.storage().persistent().get(&DataKey::Refund(refund_id.clone()))
}

pub fn set_refund(env: &Env, refund: &RefundRecord) {
    env.storage()
        .persistent()
        .set(&DataKey::Refund(refund.refund_id.clone()), refund);
}

pub fn get_max_refunds_per_order(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get(&DataKey::MaxRefundsPerOrder)
        .unwrap_or(5)
}

pub fn set_max_refunds_per_order(env: &Env, max: u32) {
    env.storage().instance().set(&DataKey::MaxRefundsPerOrder, &max);
}

pub fn get_order_refund_count(env: &Env, order_id: &String) -> u32 {
    env.storage()
        .persistent()
        .get(&DataKey::OrderRefundCount(order_id.clone()))
        .unwrap_or(0)
}

pub fn increment_order_refund_count(env: &Env, order_id: &String) {
    let count = get_order_refund_count(env, order_id) + 1;
    env.storage()
        .persistent()
        .set(&DataKey::OrderRefundCount(order_id.clone()), &count);
}

// ── Multisig ──────────────────────────────────────────────────────────────────

pub fn get_multisig(env: &Env, payment_id: &String) -> Option<MultisigPayment> {
    env.storage().persistent().get(&DataKey::Multisig(payment_id.clone()))
}

pub fn set_multisig(env: &Env, ms: &MultisigPayment) {
    env.storage()
        .persistent()
        .set(&DataKey::Multisig(ms.payment_id.clone()), ms);
}

// ── Payment Request ───────────────────────────────────────────────────────────

pub fn get_payment_request(env: &Env, request_id: &String) -> Option<PaymentRequest> {
    env.storage()
        .temporary()
        .get(&DataKey::PaymentRequest(request_id.clone()))
}

pub fn set_payment_request(env: &Env, pr: &PaymentRequest) {
    env.storage().temporary().set(
        &DataKey::PaymentRequest(pr.request_id.clone()),
        pr,
    );
}

pub fn remove_payment_request(env: &Env, request_id: &String) {
    env.storage()
        .temporary()
        .remove(&DataKey::PaymentRequest(request_id.clone()));
}

// ── Allowed Tokens ────────────────────────────────────────────────────────────

pub fn is_token_allowed(env: &Env, token: &Address) -> bool {
    env.storage().instance().has(&DataKey::AllowedToken(token.clone()))
}

pub fn set_token_allowed(env: &Env, token: &Address, allowed: bool) {
    if allowed {
        env.storage().instance().set(&DataKey::AllowedToken(token.clone()), &());
    } else {
        env.storage().instance().remove(&DataKey::AllowedToken(token.clone()));
    }
}
