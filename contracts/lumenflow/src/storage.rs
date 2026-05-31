use soroban_sdk::{contracttype, Address, Env, String, Vec};

use crate::types::{
    DisputeRecord, GlobalStats, Merchant, MultisigPayment, PaymentOrder, PaymentRequest,
    RefundRecord, Subscription, SubscriptionPlan,
};

// ── TTL constants ─────────────────────────────────────────────────────────────
//
// Soroban ledgers close approximately every 5 seconds.
// 1 year ≈ 365 * 24 * 3600 / 5 = 6,307,200 ledgers.
//
// Strategy:
//   - Merchant profiles: 2 years — merchants are long-lived business entities.
//   - Payments: 2 years — payment records must survive audits and refund windows.
//   - Refunds / disputes: 1 year — refund lifecycle completes well within this window.
//   - Multisig: 1 year — multisig payments are typically short-lived but kept for history.
//   - Index lists (MerchantPayments, PayerPayments): 2 years — must outlive the records they index.
//   - Refund count: 1 year — per-order counter only needed during the refund window.
//   - Subscriptions / plans: 2 years — recurring billing relationships are long-lived.
//   - Payer nonce: 2 years — nonces must persist as long as the payer is active.
//
// All extend_ttl calls use the same value for both `min_ttl` and `max_ttl` so
// the ledger entry is always bumped to exactly the target lifetime on every write.

/// 2 years in ledgers (~5 s/ledger).
pub const MERCHANT_TTL_LEDGERS: u32 = 12_614_400;

/// 2 years — payments must outlive the refund window and audit requirements.
pub const PAYMENT_TTL_LEDGERS: u32 = 12_614_400;

/// 1 year — refund lifecycle (initiate → approve/reject → execute) fits comfortably.
pub const REFUND_TTL_LEDGERS: u32 = 6_307_200;

/// 1 year — dispute resolution is expected to complete within months.
pub const DISPUTE_TTL_LEDGERS: u32 = 6_307_200;

/// 1 year — multisig payments are short-lived but kept for history.
pub const MULTISIG_TTL_LEDGERS: u32 = 6_307_200;

/// 2 years — index lists must outlive the individual records they reference.
pub const INDEX_TTL_LEDGERS: u32 = 12_614_400;

/// 1 year — per-order refund counter only needed during the refund window.
pub const REFUND_COUNT_TTL_LEDGERS: u32 = 6_307_200;

/// 2 years — subscription plans and active subscriptions are long-lived.
pub const SUBSCRIPTION_TTL_LEDGERS: u32 = 12_614_400;

/// 2 years — payer nonces must persist as long as the payer is active.
pub const PAYER_NONCE_TTL_LEDGERS: u32 = 12_614_400;

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
    Dispute(String),
    Multisig(String),
    PaymentRequest(String),
    LargePaymentThreshold,
    MaxRefundsPerOrder,
    OrderRefundCount(String),
    AllowedToken(Address),
    SubscriptionPlan(String),
    Subscription(String),
    PayerNonce(Address),
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
        .unwrap_or(10_000_000)
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
    env.storage().persistent().get(&DataKey::Payment(order_id.clone()))
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
    env.storage().persistent().remove(&DataKey::Payment(order_id.clone()));
}

pub fn get_merchant_payment_ids(env: &Env, merchant: &Address) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&DataKey::MerchantPayments(merchant.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn add_merchant_payment_id(env: &Env, merchant: &Address, order_id: &String) {
    let mut ids = get_merchant_payment_ids(env, merchant);
    ids.push_back(order_id.clone());
    let key = DataKey::MerchantPayments(merchant.clone());
    env.storage().persistent().set(&key, &ids);
    // Index lists must outlive the records they reference; extend to 2 years.
    env.storage()
        .persistent()
        .extend_ttl(&key, INDEX_TTL_LEDGERS, INDEX_TTL_LEDGERS);
}

pub fn remove_merchant_payment_id(env: &Env, merchant: &Address, order_id: &String) {
    let ids = get_merchant_payment_ids(env, merchant);
    let mut new_ids: Vec<String> = Vec::new(env);
    for id in ids.iter() {
        if id != *order_id {
            new_ids.push_back(id);
        }
    }
    let key = DataKey::MerchantPayments(merchant.clone());
    env.storage().persistent().set(&key, &new_ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, INDEX_TTL_LEDGERS, INDEX_TTL_LEDGERS);
}

pub fn get_payer_payment_ids(env: &Env, payer: &Address) -> Vec<String> {
    env.storage()
        .persistent()
        .get(&DataKey::PayerPayments(payer.clone()))
        .unwrap_or(Vec::new(env))
}

pub fn add_payer_payment_id(env: &Env, payer: &Address, order_id: &String) {
    let mut ids = get_payer_payment_ids(env, payer);
    ids.push_back(order_id.clone());
    let key = DataKey::PayerPayments(payer.clone());
    env.storage().persistent().set(&key, &ids);
    // Index lists must outlive the records they reference; extend to 2 years.
    env.storage()
        .persistent()
        .extend_ttl(&key, INDEX_TTL_LEDGERS, INDEX_TTL_LEDGERS);
}

pub fn remove_payer_payment_id(env: &Env, payer: &Address, order_id: &String) {
    let ids = get_payer_payment_ids(env, payer);
    let mut new_ids: Vec<String> = Vec::new(env);
    for id in ids.iter() {
        if id != *order_id {
            new_ids.push_back(id);
        }
    }
    let key = DataKey::PayerPayments(payer.clone());
    env.storage().persistent().set(&key, &new_ids);
    env.storage()
        .persistent()
        .extend_ttl(&key, INDEX_TTL_LEDGERS, INDEX_TTL_LEDGERS);
}

// ── Refund ────────────────────────────────────────────────────────────────────

pub fn get_refund(env: &Env, refund_id: &String) -> Option<RefundRecord> {
    env.storage().persistent().get(&DataKey::Refund(refund_id.clone()))
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
    let key = DataKey::OrderRefundCount(order_id.clone());
    env.storage().persistent().set(&key, &count);
    // Keep the counter alive for 1 year — the refund window is 30 days, so
    // this provides ample headroom for the rate-limit check to remain valid.
    env.storage()
        .persistent()
        .extend_ttl(&key, REFUND_COUNT_TTL_LEDGERS, REFUND_COUNT_TTL_LEDGERS);
}

// ── Dispute ───────────────────────────────────────────────────────────────────

pub fn get_dispute(env: &Env, refund_id: &String) -> Option<DisputeRecord> {
    env.storage().persistent().get(&DataKey::Dispute(refund_id.clone()))
}

pub fn set_dispute(env: &Env, dispute: &DisputeRecord) {
    let key = DataKey::Dispute(dispute.refund_id.clone());
    env.storage().persistent().set(&key, dispute);
    // Extend TTL to 1 year; dispute resolution is expected within months.
    env.storage()
        .persistent()
        .extend_ttl(&key, DISPUTE_TTL_LEDGERS, DISPUTE_TTL_LEDGERS);
}

// ── Multisig ──────────────────────────────────────────────────────────────────

pub fn get_multisig(env: &Env, payment_id: &String) -> Option<MultisigPayment> {
    env.storage().persistent().get(&DataKey::Multisig(payment_id.clone()))
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
    env.storage().temporary().set(
        &DataKey::PaymentRequest(pr.request_id.clone()),
        pr,
    );
    // Payment requests use temporary storage; their TTL is governed by the
    // caller-supplied `expires_at` field and the ledger's default temporary TTL.
    // No explicit extend_ttl is needed here.
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
        env.storage()
            .instance()
            .set(&DataKey::AllowedToken(token.clone()), &());
    } else {
        env.storage()
            .instance()
            .remove(&DataKey::AllowedToken(token.clone()));
    }
}

// ── Subscription Plan ─────────────────────────────────────────────────────────

pub fn get_subscription_plan(env: &Env, plan_id: &String) -> Option<SubscriptionPlan> {
    env.storage()
        .persistent()
        .get(&DataKey::SubscriptionPlan(plan_id.clone()))
}

pub fn set_subscription_plan(env: &Env, plan: &SubscriptionPlan) {
    let key = DataKey::SubscriptionPlan(plan.plan_id.clone());
    env.storage().persistent().set(&key, plan);
    // Extend TTL to 2 years; subscription plans are long-lived merchant
    // configurations that must remain accessible for the plan's full duration.
    env.storage()
        .persistent()
        .extend_ttl(&key, SUBSCRIPTION_TTL_LEDGERS, SUBSCRIPTION_TTL_LEDGERS);
}

// ── Subscription ──────────────────────────────────────────────────────────────

pub fn get_subscription(env: &Env, subscription_id: &String) -> Option<Subscription> {
    env.storage()
        .persistent()
        .get(&DataKey::Subscription(subscription_id.clone()))
}

pub fn set_subscription(env: &Env, sub: &Subscription) {
    let key = DataKey::Subscription(sub.subscription_id.clone());
    env.storage().persistent().set(&key, sub);
    // Extend TTL to 2 years; active subscriptions must persist across all
    // billing cycles for the lifetime of the subscriber relationship.
    env.storage()
        .persistent()
        .extend_ttl(&key, SUBSCRIPTION_TTL_LEDGERS, SUBSCRIPTION_TTL_LEDGERS);
}

// ── Payer Nonce ───────────────────────────────────────────────────────────────

pub fn get_payer_nonce(env: &Env, payer: &Address) -> u64 {
    env.storage()
        .persistent()
        .get(&DataKey::PayerNonce(payer.clone()))
        .unwrap_or(0)
}

pub fn increment_payer_nonce(env: &Env, payer: &Address) {
    let nonce = get_payer_nonce(env, payer) + 1;
    let key = DataKey::PayerNonce(payer.clone());
    env.storage().persistent().set(&key, &nonce);
    // Extend TTL to 2 years; nonces must persist as long as the payer is
    // active to prevent replay attacks across ledger epochs.
    env.storage()
        .persistent()
        .extend_ttl(&key, PAYER_NONCE_TTL_LEDGERS, PAYER_NONCE_TTL_LEDGERS);
}
