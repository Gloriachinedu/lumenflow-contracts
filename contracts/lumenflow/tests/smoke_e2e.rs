// End-to-end smoke tests covering the full payment / refund lifecycle.
// Closes issue #331.
//
// Acceptance criteria:
//   - Smoke test covers at least one complete business flow.
//   - Reports pass/fail clearly.
//   - Runs in CI via `cargo test --package lumenflow --test smoke_e2e`.
//
// Business flows exercised:
//   1. Full happy-path: register merchant -> payment -> initiate refund ->
//      approve refund -> execute refund.
//   2. Refund rejection path: initiate refund -> reject refund.
//   3. Partial refund: two partial refunds that sum to the full amount.
//   4. Nonce-payment path: process_payment_with_nonce -> full refund cycle.
//   5. Merchant + global stats accumulate correctly.

#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::Address as _, token::StellarAssetClient, Address, Bytes, Env, String,
};

use lumenflow::{
    error::PaymentError,
    types::{MerchantCategory, PaymentStatus, RefundStatus},
    PaymentProcessingContract, PaymentProcessingContractClient,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup() -> (Env, PaymentProcessingContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);
    (env, client)
}

fn str(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

fn zero_sig(env: &Env) -> Bytes {
    Bytes::from_slice(env, &[0u8; 64])
}

fn zero_key(env: &Env) -> Bytes {
    Bytes::from_slice(env, &[0u8; 32])
}

/// Bootstrap a fully configured environment.
/// Returns `(env, client, admin, merchant, payer, token)`.
fn setup_full_env() -> (
    Env,
    PaymentProcessingContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);

    client.set_admin(&admin);
    client.add_allowed_token(&admin, &token);

    client.register_merchant(
        &merchant,
        &str(&env, "E2E Store"),
        &str(&env, "E2E test merchant"),
        &str(&env, "e2e@test.local"),
        &MerchantCategory::Retail,
    );

    // Fund payer and merchant (merchant needs funds to execute refunds)
    mint(&env, &token, &payer, 100_000);
    mint(&env, &token, &merchant, 100_000);

    (env, client, admin, merchant, payer, token)
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow 1: Full happy path — payment -> initiate -> approve -> execute
// ─────────────────────────────────────────────────────────────────────────────

/// Complete business flow: register merchant, process payment, full refund cycle.
#[test]
fn test_smoke_full_payment_refund_cycle() {
    let (env, client, _admin, merchant, payer, token) = setup_full_env();

    // Payment
    client.process_payment_with_signature(
        &payer,
        &str(&env, "SMOKE_ORDER_1"),
        &merchant,
        &token,
        &5_000,
        &str(&env, "E2E smoke payment"),
        &None,
        &1u64,
        &zero_sig(&env),
        &zero_key(&env),
    );

    let payment = client.get_payment_by_id(&payer, &str(&env, "SMOKE_ORDER_1"));
    assert_eq!(payment.amount, 5_000);
    assert_eq!(payment.status, PaymentStatus::Completed);
    assert_eq!(payment.refunded_amount, 0);

    // Public summary is accessible without auth.
    let summary = client.get_payment_summary(&str(&env, "SMOKE_ORDER_1"));
    assert_eq!(summary.amount, 5_000);

    // Initiate refund (payer initiates)
    client.initiate_refund(
        &payer,
        &str(&env, "SMOKE_REFUND_1"),
        &str(&env, "SMOKE_ORDER_1"),
        &5_000,
        &str(&env, "E2E smoke full refund"),
    );

    let refund_pending = client.get_refund(&str(&env, "SMOKE_REFUND_1"));
    assert_eq!(refund_pending.status, RefundStatus::Pending);
    assert_eq!(refund_pending.amount, 5_000);

    // Merchant approves
    client.approve_refund(&merchant, &str(&env, "SMOKE_REFUND_1"));

    let refund_approved = client.get_refund(&str(&env, "SMOKE_REFUND_1"));
    assert_eq!(refund_approved.status, RefundStatus::Approved);

    // Merchant executes (signs the token transfer)
    client.execute_refund(&str(&env, "SMOKE_REFUND_1"));

    let refund_done = client.get_refund(&str(&env, "SMOKE_REFUND_1"));
    assert_eq!(refund_done.status, RefundStatus::Completed);

    // Payment must reflect fully refunded state.
    let payment_final = client.get_payment_by_id(&payer, &str(&env, "SMOKE_ORDER_1"));
    assert_eq!(payment_final.status, PaymentStatus::FullyRefunded);
    assert_eq!(payment_final.refunded_amount, 5_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow 2: Refund rejection path
// ─────────────────────────────────────────────────────────────────────────────

/// Merchant rejects a refund; payment remains Completed and unrefunded.
#[test]
fn test_smoke_refund_rejection_cycle() {
    let (env, client, _admin, merchant, payer, token) = setup_full_env();

    client.process_payment_with_signature(
        &payer,
        &str(&env, "SMOKE_ORDER_REJ"),
        &merchant,
        &token,
        &3_000,
        &str(&env, "rejection test"),
        &None,
        &1u64,
        &zero_sig(&env),
        &zero_key(&env),
    );

    client.initiate_refund(
        &payer,
        &str(&env, "SMOKE_REFUND_REJ"),
        &str(&env, "SMOKE_ORDER_REJ"),
        &3_000,
        &str(&env, "Refund rejection smoke test"),
    );

    client.reject_refund(&merchant, &str(&env, "SMOKE_REFUND_REJ"));

    let refund = client.get_refund(&str(&env, "SMOKE_REFUND_REJ"));
    assert_eq!(refund.status, RefundStatus::Rejected);

    // Payment must still be Completed — no funds moved.
    let payment = client.get_payment_by_id(&payer, &str(&env, "SMOKE_ORDER_REJ"));
    assert_eq!(payment.status, PaymentStatus::Completed);
    assert_eq!(payment.refunded_amount, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow 3: Partial refund accumulation
// ─────────────────────────────────────────────────────────────────────────────

/// Two sequential partial refunds that together equal the full payment amount.
#[test]
fn test_smoke_partial_refund_cycle() {
    let (env, client, _admin, merchant, payer, token) = setup_full_env();

    let payment_amount: i128 = 4_000;

    client.process_payment_with_signature(
        &payer,
        &str(&env, "SMOKE_ORDER_PART"),
        &merchant,
        &token,
        &payment_amount,
        &str(&env, "partial refund test"),
        &None,
        &1u64,
        &zero_sig(&env),
        &zero_key(&env),
    );

    // First partial: 1_500
    client.initiate_refund(
        &payer,
        &str(&env, "SMOKE_REFUND_P1"),
        &str(&env, "SMOKE_ORDER_PART"),
        &1_500,
        &str(&env, "Partial refund 1 of 2"),
    );
    client.approve_refund(&merchant, &str(&env, "SMOKE_REFUND_P1"));
    client.execute_refund(&str(&env, "SMOKE_REFUND_P1"));

    let payment_mid = client.get_payment_by_id(&payer, &str(&env, "SMOKE_ORDER_PART"));
    assert_eq!(payment_mid.status, PaymentStatus::PartiallyRefunded);
    assert_eq!(payment_mid.refunded_amount, 1_500);

    // Second partial: 2_500 (total = 4_000 = full amount)
    client.initiate_refund(
        &payer,
        &str(&env, "SMOKE_REFUND_P2"),
        &str(&env, "SMOKE_ORDER_PART"),
        &2_500,
        &str(&env, "Partial refund 2 of 2"),
    );
    client.approve_refund(&merchant, &str(&env, "SMOKE_REFUND_P2"));
    client.execute_refund(&str(&env, "SMOKE_REFUND_P2"));

    let payment_final = client.get_payment_by_id(&payer, &str(&env, "SMOKE_ORDER_PART"));
    assert_eq!(payment_final.status, PaymentStatus::FullyRefunded);
    assert_eq!(payment_final.refunded_amount, payment_amount);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow 4: Nonce-payment full refund cycle
// ─────────────────────────────────────────────────────────────────────────────

/// Full cycle using process_payment_with_nonce instead of signature-based payment.
#[test]
fn test_smoke_nonce_payment_full_refund_cycle() {
    let (env, client, _admin, merchant, payer, token) = setup_full_env();

    // Starting nonce is 0.
    assert_eq!(client.get_payer_nonce(&payer), 0u64);

    client.process_payment_with_nonce(
        &payer,
        &str(&env, "SMOKE_NONCE_ORDER_1"),
        &merchant,
        &token,
        &2_000,
        &str(&env, "nonce payment smoke test"),
        &None,
        &0u64,
    );

    // Nonce advances after a successful payment.
    assert_eq!(client.get_payer_nonce(&payer), 1u64);

    let payment = client.get_payment_by_id(&payer, &str(&env, "SMOKE_NONCE_ORDER_1"));
    assert_eq!(payment.amount, 2_000);
    assert_eq!(payment.status, PaymentStatus::Completed);

    // Full refund cycle.
    client.initiate_refund(
        &payer,
        &str(&env, "SMOKE_NONCE_REFUND_1"),
        &str(&env, "SMOKE_NONCE_ORDER_1"),
        &2_000,
        &str(&env, "Full refund for nonce payment"),
    );
    client.approve_refund(&merchant, &str(&env, "SMOKE_NONCE_REFUND_1"));
    client.execute_refund(&str(&env, "SMOKE_NONCE_REFUND_1"));

    let final_payment = client.get_payment_by_id(&payer, &str(&env, "SMOKE_NONCE_ORDER_1"));
    assert_eq!(final_payment.status, PaymentStatus::FullyRefunded);

    // Subsequent nonce=1 payment also succeeds.
    client.process_payment_with_nonce(
        &payer,
        &str(&env, "SMOKE_NONCE_ORDER_2"),
        &merchant,
        &token,
        &500,
        &str(&env, "second nonce payment"),
        &None,
        &1u64,
    );
    assert_eq!(client.get_payer_nonce(&payer), 2u64);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow 5: Stats update correctly across the full cycle
// ─────────────────────────────────────────────────────────────────────────────

/// Global and merchant statistics are updated correctly across a full cycle.
#[test]
fn test_smoke_stats_update_across_full_cycle() {
    let (env, client, admin, merchant, payer, token) = setup_full_env();

    client.process_payment_with_signature(
        &payer,
        &str(&env, "SMOKE_STATS_ORDER"),
        &merchant,
        &token,
        &1_000,
        &str(&env, "stats test"),
        &None,
        &1u64,
        &zero_sig(&env),
        &zero_key(&env),
    );

    let global_after_payment = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(global_after_payment.total_payments, 1);
    assert!(global_after_payment.total_volume >= 1_000);

    client.initiate_refund(
        &payer,
        &str(&env, "SMOKE_STATS_REFUND"),
        &str(&env, "SMOKE_STATS_ORDER"),
        &1_000,
        &str(&env, "Stats smoke refund"),
    );
    client.approve_refund(&merchant, &str(&env, "SMOKE_STATS_REFUND"));
    client.execute_refund(&str(&env, "SMOKE_STATS_REFUND"));

    let global_final = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(global_final.total_refunds, 1);
    assert_eq!(global_final.total_refund_volume, 1_000);

    let merchant_stats = client.get_merchant_stats(&merchant);
    assert_eq!(merchant_stats.total_payments, 1);
    assert_eq!(merchant_stats.total_refunds, 1);
    assert_eq!(merchant_stats.total_refund_volume, 1_000);
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow 6: USDC (Stellar SAC) full payment + refund cycle — issue #1576
// ─────────────────────────────────────────────────────────────────────────────

/// Full payment + refund cycle using a USDC-like Stellar Asset Contract token.
///
/// The token is registered via `register_stellar_asset_contract_v2` with a
/// dedicated issuer (mirroring the USDC SAC on mainnet/testnet) and must be
/// explicitly allowlisted before it can be used for payments.
#[test]
fn test_smoke_usdc_payment_refund_cycle() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);

    // USDC-like SAC: dedicated issuer, 7 decimal places on Stellar.
    let usdc_issuer = Address::generate(&env);
    let usdc = env
        .register_stellar_asset_contract_v2(usdc_issuer.clone())
        .address();

    client.set_admin(&admin);
    // Issue #1576: USDC must be allowlisted before use.
    client.add_allowed_token(&admin, &usdc);

    client.register_merchant(
        &merchant,
        &str(&env, "USDC Store"),
        &str(&env, "USDC integration merchant"),
        &str(&env, "usdc@test.local"),
        &MerchantCategory::Retail,
    );

    // 10 USDC (7 decimals) for the payer, 10 USDC for the merchant to refund.
    let ten_usdc: i128 = 100_000_000;
    mint(&env, &usdc, &payer, ten_usdc);
    mint(&env, &usdc, &merchant, ten_usdc);

    let usdc_client = StellarAssetClient::new(&env, &usdc);
    assert_eq!(usdc_client.balance(&payer), ten_usdc);

    // Payment of 2.5 USDC.
    let payment_amount: i128 = 25_000_000;
    client.process_payment_with_signature(
        &payer,
        &str(&env, "USDC_ORDER_1"),
        &merchant,
        &usdc,
        &payment_amount,
        &str(&env, "USDC smoke payment"),
        &None,
        &1u64,
        &zero_sig(&env),
        &zero_key(&env),
    );

    // Balances moved: payer debited, merchant credited.
    assert_eq!(usdc_client.balance(&payer), ten_usdc - payment_amount);
    assert_eq!(usdc_client.balance(&merchant), ten_usdc + payment_amount);

    let payment = client.get_payment_by_id(&payer, &str(&env, "USDC_ORDER_1"));
    assert_eq!(payment.amount, payment_amount);
    assert_eq!(payment.status, PaymentStatus::Completed);

    // Full refund cycle in USDC.
    client.initiate_refund(
        &payer,
        &str(&env, "USDC_REFUND_1"),
        &str(&env, "USDC_ORDER_1"),
        &payment_amount,
        &str(&env, "USDC full refund"),
    );
    assert_eq!(
        client.get_refund(&str(&env, "USDC_REFUND_1")).status,
        RefundStatus::Pending
    );

    client.approve_refund(&merchant, &str(&env, "USDC_REFUND_1"));
    assert_eq!(
        client.get_refund(&str(&env, "USDC_REFUND_1")).status,
        RefundStatus::Approved
    );

    client.execute_refund(&str(&env, "USDC_REFUND_1"));
    assert_eq!(
        client.get_refund(&str(&env, "USDC_REFUND_1")).status,
        RefundStatus::Completed
    );

    // Balances restored to their pre-payment values.
    assert_eq!(usdc_client.balance(&payer), ten_usdc);
    assert_eq!(usdc_client.balance(&merchant), ten_usdc);

    let final_payment = client.get_payment_by_id(&payer, &str(&env, "USDC_ORDER_1"));
    assert_eq!(final_payment.status, PaymentStatus::FullyRefunded);
    assert_eq!(final_payment.refunded_amount, payment_amount);
}

// ─────────────────────────────────────────────────────────────────────────────
// Regression: state stays final when a token transfer fails — issue #1507
// ─────────────────────────────────────────────────────────────────────────────

/// Issue #1507: state must be marked final *before* the external token call
/// (checks-effects-interactions). If the token transfer fails, the contract
/// must not leave a half-written, non-final record behind.
///
/// The payer is funded with less than the payment amount, so the token
/// transfer fails. The payment record must not be observable as `Completed`
/// and no refund can be initiated against it.
#[test]
fn test_regression_state_final_before_transfer_on_failed_payment() {
    let (env, client, _admin, merchant, payer, token) = setup_full_env();

    // Drain the payer's balance so the transfer must fail.
    let payer_balance = StellarAssetClient::new(&env, &token).balance(&payer);
    StellarAssetClient::new(&env, &token).burn(&payer, &payer_balance);

    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "FAILED_ORDER_1"),
        &merchant,
        &token,
        &1_000,
        &str(&env, "insufficient funds"),
        &None,
        &1u64,
        &zero_sig(&env),
        &zero_key(&env),
    );
    assert!(result.is_err(), "payment must fail without funds");

    // No refund can be initiated against a payment that never completed.
    let refund_result = client.try_initiate_refund(
        &payer,
        &str(&env, "FAILED_REFUND_1"),
        &str(&env, "FAILED_ORDER_1"),
        &1_000,
        &str(&env, "refund against failed payment"),
    );
    assert!(
        refund_result.is_err(),
        "refund must not be possible for a failed payment"
    );
}

/// Issue #1507: a refund whose token transfer fails must not be left in a
/// non-final state that allows double-spending of the refund amount.
#[test]
fn test_regression_state_final_before_transfer_on_failed_refund() {
    let (env, client, _admin, merchant, payer, token) = setup_full_env();

    client.process_payment_with_signature(
        &payer,
        &str(&env, "FAILED_REFUND_ORDER"),
        &merchant,
        &token,
        &1_000,
        &str(&env, "refund failure test"),
        &None,
        &1u64,
        &zero_sig(&env),
        &zero_key(&env),
    );

    client.initiate_refund(
        &payer,
        &str(&env, "FAILED_REFUND"),
        &str(&env, "FAILED_REFUND_ORDER"),
        &1_000,
        &str(&env, "refund that will fail"),
    );
    client.approve_refund(&merchant, &str(&env, "FAILED_REFUND"));

    // Drain the merchant so the refund transfer must fail.
    let merchant_balance = StellarAssetClient::new(&env, &token).balance(&merchant);
    StellarAssetClient::new(&env, &token).burn(&merchant, &merchant_balance);

    let result = client.try_execute_refund(&str(&env, "FAILED_REFUND"));
    assert!(result.is_err(), "refund must fail without merchant funds");

    // The payment must not record the refunded amount.
    let payment = client.get_payment_by_id(&payer, &str(&env, "FAILED_REFUND_ORDER"));
    assert_eq!(payment.refunded_amount, 0);
    assert_eq!(payment.status, PaymentStatus::Completed);
}

// ─────────────────────────────────────────────────────────────────────────────
// Boundary: refund exceeding original amount is blocked
// ─────────────────────────────────────────────────────────────────────────────

/// Attempting to refund more than the original payment amount must fail.
#[test]
fn test_smoke_refund_exceeds_original_rejected() {
    let (env, client, _admin, merchant, payer, token) = setup_full_env();

    client.process_payment_with_signature(
        &payer,
        &str(&env, "SMOKE_ORDER_EXCEED"),
        &merchant,
        &token,
        &1_000,
        &str(&env, "exceed test"),
        &None,
        &1u64,
        &zero_sig(&env),
        &zero_key(&env),
    );

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "SMOKE_REFUND_EXCEED"),
        &str(&env, "SMOKE_ORDER_EXCEED"),
        &2_000, // more than original 1_000
        &str(&env, "Exceeds original amount"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundExceedsOriginal)));
}
