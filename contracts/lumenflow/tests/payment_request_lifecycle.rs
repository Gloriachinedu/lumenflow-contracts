/// Integration tests for the full payment request lifecycle — issue #1028.
///
/// Covers the three acceptance-criteria scenarios:
///   1. create → pay → verify merchant receives funds → verify request is gone (Paid)
///   2. create → cancel → verify request is removed (Cancelled)
///   3. create → TTL expires → pay attempt fails with PaymentExpired
extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, String,
};

use lumenflow::{
    error::PaymentError, MerchantCategory, PaymentProcessingContract,
    PaymentProcessingContractClient,
};

// ── Test helpers ──────────────────────────────────────────────────────────────

/// Set up a fresh environment with the lumenflow contract, admin, merchant,
/// payer and a funded token. Returns all handles needed by the tests.
fn setup() -> (
    Env,
    PaymentProcessingContractClient<'static>,
    Address, // admin
    Address, // merchant
    Address, // payer
    Address, // token
) {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(token_admin.clone())
        .address();

    // Initialise contract
    client.set_admin(&admin);
    client.add_allowed_token(&admin, &token);

    // Register merchant
    client.register_merchant(
        &merchant,
        &String::from_str(&env, "Test Store"),
        &String::from_str(&env, "A test merchant"),
        &String::from_str(&env, "store@example.com"),
        &MerchantCategory::Retail,
    );

    // Fund payer
    StellarAssetClient::new(&env, &token).mint(&payer, &100_000_i128);

    (env, client, admin, merchant, payer, token)
}

// ── AC1: create → pay → verify merchant receives funds → verify request is gone ─

/// Full happy-path: merchant creates a request, payer pays it, merchant receives
/// the funds, and the request no longer exists (returns PaymentNotFound on a
/// second pay attempt).
#[test]
fn test_create_pay_verify_merchant_balance_and_request_status_paid() {
    let (env, client, _admin, merchant, payer, token) = setup();
    let token_client = soroban_sdk::token::Client::new(&env, &token);

    let request_id = String::from_str(&env, "REQ_LIFECYCLE_001");
    let amount: i128 = 2_500;
    let ttl: u64 = 86_400; // 1 day

    // Create the payment request
    client.create_payment_request(
        &merchant,
        &request_id,
        &token,
        &amount,
        &String::from_str(&env, "Invoice #001"),
        &ttl,
    );

    // Record merchant balance before payment
    let merchant_balance_before = token_client.balance(&merchant);

    // Payer pays the request
    client.pay_payment_request(&payer, &request_id);

    // AC: merchant receives exactly the requested amount
    let merchant_balance_after = token_client.balance(&merchant);
    assert_eq!(
        merchant_balance_after - merchant_balance_before,
        amount,
        "merchant should receive exactly the requested amount"
    );

    // AC: payer balance decreases by the same amount
    let payer_balance = token_client.balance(&payer);
    assert_eq!(
        payer_balance,
        100_000 - amount,
        "payer balance should decrease by the payment amount"
    );

    // AC: request is removed — a second pay attempt must fail with PaymentNotFound
    let second_pay = client.try_pay_payment_request(&payer, &request_id);
    assert_eq!(
        second_pay,
        Err(Ok(PaymentError::PaymentNotFound)),
        "request should be gone after it is paid"
    );
}

/// Paying a request creates a PaymentOrder in history for the merchant.
#[test]
fn test_paid_request_appears_in_merchant_payment_history() {
    let (env, client, _admin, merchant, payer, token) = setup();

    let request_id = String::from_str(&env, "REQ_HISTORY_001");
    let amount: i128 = 1_000;

    client.create_payment_request(
        &merchant,
        &request_id,
        &token,
        &amount,
        &String::from_str(&env, "Invoice"),
        &86_400,
    );

    client.pay_payment_request(&payer, &request_id);

    // The payment should appear in the merchant's history
    let history = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &None,
        &lumenflow::SortField::Date,
        &lumenflow::SortOrder::Descending,
    );
    assert_eq!(history.payments.len(), 1);
    assert_eq!(history.payments.get(0).unwrap().order_id, request_id);
    assert_eq!(history.payments.get(0).unwrap().amount, amount);
}

// ── AC2: create → cancel → verify request is removed ─────────────────────────

/// Merchant cancels their own request; afterwards the request cannot be paid.
#[test]
fn test_create_cancel_verify_request_status_cancelled() {
    let (env, client, _admin, merchant, payer, token) = setup();

    let request_id = String::from_str(&env, "REQ_CANCEL_001");

    client.create_payment_request(
        &merchant,
        &request_id,
        &token,
        &500_i128,
        &String::from_str(&env, "Cancellable invoice"),
        &86_400,
    );

    // Merchant cancels the request
    client.cancel_payment_request(&merchant, &request_id);

    // AC: request no longer exists — pay attempt must fail with PaymentNotFound
    let pay_after_cancel = client.try_pay_payment_request(&payer, &request_id);
    assert_eq!(
        pay_after_cancel,
        Err(Ok(PaymentError::PaymentNotFound)),
        "request should not be payable after cancellation"
    );
}

/// Only the merchant who created the request can cancel it; a different address
/// must receive Unauthorized.
#[test]
fn test_cancel_by_non_merchant_fails_with_unauthorized() {
    let (env, client, _admin, merchant, payer, token) = setup();

    let request_id = String::from_str(&env, "REQ_CANCEL_002");

    client.create_payment_request(
        &merchant,
        &request_id,
        &token,
        &500_i128,
        &String::from_str(&env, "Invoice"),
        &86_400,
    );

    // Payer attempts to cancel — should be rejected
    let result = client.try_cancel_payment_request(&payer, &request_id);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

/// Cancelling a non-existent request returns PaymentNotFound.
#[test]
fn test_cancel_nonexistent_request_returns_payment_not_found() {
    let (env, client, _admin, merchant, _payer, _token) = setup();

    let result =
        client.try_cancel_payment_request(&merchant, &String::from_str(&env, "DOES_NOT_EXIST"));
    assert_eq!(result, Err(Ok(PaymentError::PaymentNotFound)));
}

// ── AC3: create → TTL expires → pay attempt fails with RequestExpired ─────────

/// After the TTL elapses a pay attempt must fail with PaymentExpired and the
/// request must be removed from storage.
#[test]
fn test_create_ttl_expires_pay_fails_with_request_expired() {
    let (env, client, _admin, merchant, payer, token) = setup();

    let request_id = String::from_str(&env, "REQ_EXPIRE_001");
    let ttl: u64 = 3_600; // 1 hour

    client.create_payment_request(
        &merchant,
        &request_id,
        &token,
        &750_i128,
        &String::from_str(&env, "Short-lived invoice"),
        &ttl,
    );

    // Advance ledger time past the TTL
    env.ledger().with_mut(|l| l.timestamp += ttl + 1);

    // AC: pay attempt returns PaymentExpired
    let result = client.try_pay_payment_request(&payer, &request_id);
    assert_eq!(
        result,
        Err(Ok(PaymentError::PaymentExpired)),
        "paying an expired request must return PaymentExpired"
    );

    // AC: request is cleaned up — a second attempt also returns PaymentNotFound
    // (the request was removed by the first expired call)
    let second_attempt = client.try_pay_payment_request(&payer, &request_id);
    assert_eq!(
        second_attempt,
        Err(Ok(PaymentError::PaymentNotFound)),
        "expired request should be removed after the first expired attempt"
    );
}

/// A request paid exactly at the TTL boundary (not yet expired) should succeed.
#[test]
fn test_pay_at_ttl_boundary_succeeds() {
    let (env, client, _admin, merchant, payer, token) = setup();

    let request_id = String::from_str(&env, "REQ_BOUNDARY_001");
    let ttl: u64 = 3_600;

    let created_at = env.ledger().timestamp();

    client.create_payment_request(
        &merchant,
        &request_id,
        &token,
        &100_i128,
        &String::from_str(&env, "Boundary invoice"),
        &ttl,
    );

    // Advance to exactly expires_at (created_at + ttl) — not past it
    env.ledger().with_mut(|l| l.timestamp = created_at + ttl);

    // Payment at the exact expiry timestamp should succeed (not expired yet)
    let result = client.try_pay_payment_request(&payer, &request_id);
    assert!(
        result.is_ok(),
        "request paid exactly at expires_at should succeed, got {result:?}"
    );
}
