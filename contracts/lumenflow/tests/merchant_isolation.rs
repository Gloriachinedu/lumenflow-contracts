// Integration tests for merchant isolation.
// Closes issue #876.
//
// These tests verify that one merchant cannot act on, read, or mutate another
// merchant's payments and refunds, and that per-merchant statistics never leak
// across merchant boundaries.
//
// Run with: `cargo test --package lumenflow --test merchant_isolation`
//
// Acceptance criteria coverage:
//   - Normal path: each merchant CAN operate on its own resources.
//   - Failure path: a foreign merchant is rejected with `Unauthorized` when it
//     targets another merchant's payment, refund, profile, or stats.

#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    Address, Env, String,
};

use lumenflow::{
    error::PaymentError,
    types::MerchantCategory,
    PaymentProcessingContract, PaymentProcessingContractClient,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn str(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

fn register(client: &PaymentProcessingContractClient<'_>, env: &Env, merchant: &Address, name: &str) {
    client.register_merchant(
        merchant,
        &str(env, name),
        &str(env, "isolation test merchant"),
        &str(env, "merchant@test.local"),
        &MerchantCategory::Retail,
        &None,
    );
}

/// Bootstrap: admin, allowed token, two registered+funded merchants, one payer.
struct World {
    env: Env,
    client: PaymentProcessingContractClient<'static>,
    admin: Address,
    merchant_a: Address,
    merchant_b: Address,
    payer: Address,
    token: Address,
}

fn setup() -> World {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let merchant_a = Address::generate(&env);
    let merchant_b = Address::generate(&env);
    let payer = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);

    client.set_admin(&admin);
    client.add_allowed_token(&admin, &token);

    register(&client, &env, &merchant_a, "Merchant A");
    register(&client, &env, &merchant_b, "Merchant B");

    mint(&env, &token, &payer, 1_000_000);
    mint(&env, &token, &merchant_a, 1_000_000);
    mint(&env, &token, &merchant_b, 1_000_000);

    World { env, client, admin, merchant_a, merchant_b, payer, token }
}

/// Payer pays `merchant` for `order_id` / `amount` via the nonce path.
fn pay(w: &World, order_id: &str, merchant: &Address, amount: i128, nonce: u64) {
    w.client.process_payment_with_nonce(
        &w.payer,
        &str(&w.env, order_id),
        merchant,
        &w.token,
        &amount,
        &str(&w.env, "isolation payment"),
        &None,
        &nonce,
    );
}

// ── Refund approval / rejection isolation ────────────────────────────────────

#[test]
fn merchant_cannot_approve_a_foreign_merchants_refund() {
    let w = setup();
    pay(&w, "ISO_ORDER_1", &w.merchant_a, 5_000, 0);

    w.client.initiate_refund(
        &w.payer,
        &str(&w.env, "ISO_REFUND_1"),
        &str(&w.env, "ISO_ORDER_1"),
        &5_000,
        &str(&w.env, "buyer changed their mind"),
    );

    // Merchant B has no relationship to this payment.
    let foreign = w
        .client
        .try_approve_refund(&w.merchant_b, &str(&w.env, "ISO_REFUND_1"));
    assert_eq!(foreign, Err(Ok(PaymentError::Unauthorized)));

    // Merchant A (the payment's merchant) can approve — normal path still works.
    w.client
        .approve_refund(&w.merchant_a, &str(&w.env, "ISO_REFUND_1"));
}

#[test]
fn merchant_cannot_reject_a_foreign_merchants_refund() {
    let w = setup();
    pay(&w, "ISO_ORDER_2", &w.merchant_a, 3_000, 0);

    w.client.initiate_refund(
        &w.payer,
        &str(&w.env, "ISO_REFUND_2"),
        &str(&w.env, "ISO_ORDER_2"),
        &3_000,
        &str(&w.env, "item not received"),
    );

    let foreign = w
        .client
        .try_reject_refund(&w.merchant_b, &str(&w.env, "ISO_REFUND_2"));
    assert_eq!(foreign, Err(Ok(PaymentError::Unauthorized)));

    // The refund is untouched and Merchant A can still act on it.
    w.client
        .reject_refund(&w.merchant_a, &str(&w.env, "ISO_REFUND_2"));
}

// ── Refund initiation isolation ─────────────────────────────────────────────

#[test]
fn merchant_cannot_initiate_a_refund_for_a_foreign_payment() {
    let w = setup();
    pay(&w, "ISO_ORDER_3", &w.merchant_a, 2_000, 0);

    // Merchant B is neither the payer nor the merchant of ISO_ORDER_3.
    let foreign = w.client.try_initiate_refund(
        &w.merchant_b,
        &str(&w.env, "ISO_REFUND_3"),
        &str(&w.env, "ISO_ORDER_3"),
        &2_000,
        &str(&w.env, "not your order"),
    );
    assert_eq!(foreign, Err(Ok(PaymentError::Unauthorized)));

    // Merchant A may initiate a refund on its own payment.
    w.client.initiate_refund(
        &w.merchant_a,
        &str(&w.env, "ISO_REFUND_3"),
        &str(&w.env, "ISO_ORDER_3"),
        &2_000,
        &str(&w.env, "merchant-initiated refund"),
    );
}

// ── Payment read isolation ─────────────────────────────────────────────────

#[test]
fn merchant_cannot_read_a_foreign_payment() {
    let w = setup();
    pay(&w, "ISO_ORDER_4", &w.merchant_a, 7_500, 0);

    let foreign = w
        .client
        .try_get_payment_by_id(&w.merchant_b, &str(&w.env, "ISO_ORDER_4"));
    assert_eq!(foreign, Err(Ok(PaymentError::Unauthorized)));

    // The payer, the owning merchant, and the admin can all read it.
    for caller in [&w.payer, &w.merchant_a, &w.admin] {
        let payment = w
            .client
            .get_payment_by_id(caller, &str(&w.env, "ISO_ORDER_4"));
        assert_eq!(payment.amount, 7_500);
        assert_eq!(payment.merchant_address, w.merchant_a);
    }
}

// ── Payment mutation isolation ────────────────────────────────────────────

#[test]
fn merchant_cannot_update_a_foreign_payments_status() {
    let w = setup();
    pay(&w, "ISO_ORDER_5", &w.merchant_a, 4_000, 0);

    let foreign = w.client.try_update_payment_status(
        &w.merchant_b,
        &str(&w.env, "ISO_ORDER_5"),
        &1_000,
    );
    assert_eq!(foreign, Err(Ok(PaymentError::Unauthorized)));

    // Owning merchant can update its own payment.
    w.client
        .update_payment_status(&w.merchant_a, &str(&w.env, "ISO_ORDER_5"), &1_000);
    let payment = w
        .client
        .get_payment_by_id(&w.merchant_a, &str(&w.env, "ISO_ORDER_5"));
    assert_eq!(payment.refunded_amount, 1_000);
}

// ── Merchant profile isolation ───────────────────────────────────────────

#[test]
fn merchant_cannot_deactivate_another_merchant() {
    let w = setup();

    let foreign = w
        .client
        .try_deactivate_merchant(&w.merchant_b, &w.merchant_a);
    assert_eq!(foreign, Err(Ok(PaymentError::Unauthorized)));

    // Merchant A is still active; only the admin may deactivate it.
    assert!(w.client.get_merchant(&w.merchant_a).active);
    w.client.deactivate_merchant(&w.admin, &w.merchant_a);
    assert!(!w.client.get_merchant(&w.merchant_a).active);
}

// ── Statistics isolation ────────────────────────────────────────────────

#[test]
fn merchant_statistics_do_not_leak_across_merchants() {
    let w = setup();

    // Two payments to Merchant A, none to Merchant B.
    pay(&w, "ISO_STATS_A1", &w.merchant_a, 6_000, 0);
    pay(&w, "ISO_STATS_A2", &w.merchant_a, 1_500, 1);

    let a = w.client.get_merchant_stats(&w.merchant_a);
    assert_eq!(a.total_payments, 2);
    assert_eq!(a.total_volume, 7_500);

    let b = w.client.get_merchant_stats(&w.merchant_b);
    assert_eq!(b.total_payments, 0);
    assert_eq!(b.total_volume, 0);
    assert_eq!(b.total_refund_volume, 0);
}
