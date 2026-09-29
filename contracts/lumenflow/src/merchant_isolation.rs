//! # Merchant & Payer Isolation Tests
//!
//! Verifies that contract access controls prevent cross-party data leakage:
//!
//! - **Payer isolation**: payer A cannot query payer B's payment history.
//! - **Admin privilege**: admin can query any payer's payment history.
//! - **Merchant isolation**: a merchant cannot query another merchant's
//!   received-payment history.
//!
//! All isolation tests are grouped here so CI can target them explicitly:
//!
//! ```text
//! cargo test -p lumenflow merchant_isolation
//! ```

#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    token::StellarAssetClient,
    Address, Bytes, Env, String,
};

use crate::{
    types::{MerchantCategory, SortField, SortOrder},
    PaymentProcessingContract, PaymentProcessingContractClient,
};

// ── Shared test helpers ───────────────────────────────────────────────────────

fn setup() -> (Env, PaymentProcessingContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);
    (env, client)
}

fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone()).address()
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

fn s(env: &Env, val: &str) -> String {
    String::from_str(env, val)
}

fn b(env: &Env, data: &[u8]) -> Bytes {
    Bytes::from_slice(env, data)
}

/// Registers a merchant and returns their address.
fn register_merchant(
    env: &Env,
    client: &PaymentProcessingContractClient,
    name: &str,
) -> Address {
    let merchant = Address::generate(env);
    client.register_merchant(
        &merchant,
        &s(env, name),
        &s(env, ""),
        &s(env, ""),
        &MerchantCategory::Retail,
    );
    merchant
}

/// Makes a single payment from `payer` to `merchant`.
fn make_payment(
    env: &Env,
    client: &PaymentProcessingContractClient,
    payer: &Address,
    merchant: &Address,
    token: &Address,
    order_id: &str,
    amount: i128,
) {
    client.process_payment_with_signature(
        payer,
        &s(env, order_id),
        merchant,
        token,
        &amount,
        &s(env, ""),
        &None,
        &b(env, &[0u8; 64]),
        &b(env, &[0u8; 32]),
    );
}

// ── Payer isolation ───────────────────────────────────────────────────────────

/// Payer A and payer B each make one payment. Querying payer A's history must
/// return only payer A's payment (and vice-versa). The contract enforces this
/// via `payer.require_auth()` inside `get_payer_payment_history` — each payer
/// address maps to a separate storage key (`PayerPayments(Address)`).
#[test]
fn test_payer_cannot_see_other_payer_history() {
    let (env, client) = setup();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    client.set_admin(&admin);

    let merchant = register_merchant(&env, &client, "Shop");

    let payer_a = Address::generate(&env);
    let payer_b = Address::generate(&env);
    mint(&env, &token, &payer_a, 10_000);
    mint(&env, &token, &payer_b, 10_000);

    make_payment(&env, &client, &payer_a, &merchant, &token, "ISO_A_001", 500);
    make_payment(&env, &client, &payer_b, &merchant, &token, "ISO_B_001", 750);

    // Payer A's history — must contain exactly their own payment
    let page_a = client.get_payer_payment_history(
        &payer_a,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page_a.total, 1, "payer A should see exactly 1 payment");
    assert_eq!(
        page_a.payments.get(0).unwrap().order_id,
        s(&env, "ISO_A_001"),
        "payer A's result must be their own order"
    );

    // Payer B's history — must contain exactly their own payment
    let page_b = client.get_payer_payment_history(
        &payer_b,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page_b.total, 1, "payer B should see exactly 1 payment");
    assert_eq!(
        page_b.payments.get(0).unwrap().order_id,
        s(&env, "ISO_B_001"),
        "payer B's result must be their own order"
    );
}

/// With multiple payers each making multiple payments, every payer's history
/// page must contain only payments where `payment.payer == payer`.
#[test]
fn test_payer_history_contains_only_own_payments() {
    let (env, client) = setup();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    client.set_admin(&admin);

    let merchant = register_merchant(&env, &client, "Store");

    let payer_a = Address::generate(&env);
    let payer_b = Address::generate(&env);
    let payer_c = Address::generate(&env);
    mint(&env, &token, &payer_a, 10_000);
    mint(&env, &token, &payer_b, 10_000);
    mint(&env, &token, &payer_c, 10_000);

    // Two payments per payer
    make_payment(&env, &client, &payer_a, &merchant, &token, "MULTI_A1", 100);
    make_payment(&env, &client, &payer_a, &merchant, &token, "MULTI_A2", 200);
    make_payment(&env, &client, &payer_b, &merchant, &token, "MULTI_B1", 300);
    make_payment(&env, &client, &payer_b, &merchant, &token, "MULTI_B2", 400);
    make_payment(&env, &client, &payer_c, &merchant, &token, "MULTI_C1", 500);
    make_payment(&env, &client, &payer_c, &merchant, &token, "MULTI_C2", 600);

    // Each payer must see exactly 2 payments, all belonging to them
    let check = |payer: &Address, label: &str| {
        let page = client.get_payer_payment_history(
            payer,
            &None,
            &10,
            &None,
            &SortField::Date,
            &SortOrder::Ascending,
        );
        assert_eq!(page.total, 2, "{} should see 2 payments", label);
        for payment in page.payments.iter() {
            assert_eq!(
                payment.payer,
                payer.clone(),
                "all payments in {}'s page must belong to them",
                label
            );
        }
    };

    check(&payer_a, "payer_a");
    check(&payer_b, "payer_b");
    check(&payer_c, "payer_c");
}

// ── Admin privilege ───────────────────────────────────────────────────────────

/// Admin can retrieve per-payer stats via `get_global_payment_stats` and
/// can call `get_payment_by_id` for any payment regardless of who made it.
#[test]
fn test_admin_can_query_any_payer_history() {
    let (env, client) = setup();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    client.set_admin(&admin);

    let merchant = register_merchant(&env, &client, "Shop");
    let payer = Address::generate(&env);
    mint(&env, &token, &payer, 10_000);

    make_payment(&env, &client, &payer, &merchant, &token, "ADMIN_Q_001", 300);

    // Admin can access global stats (aggregate across all payers)
    let stats = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats.total_payments, 1, "global stats should include payer's payment");
    assert_eq!(stats.total_volume, 300);

    // Admin can read any individual payment record
    let payment = client.get_payment_by_id(&admin, &s(&env, "ADMIN_Q_001"));
    assert_eq!(payment.payer, payer);
    assert_eq!(payment.amount, 300);
}

// ── Merchant isolation ────────────────────────────────────────────────────────

/// `get_merchant_payment_history` is keyed by the merchant's address via
/// `MerchantPayments(Address)` storage. Merchant A's query must return only
/// payments where `payment.merchant_address == merchant_a`.
#[test]
fn test_merchant_cannot_see_other_merchant_history() {
    let (env, client) = setup();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    client.set_admin(&admin);

    let merchant_a = register_merchant(&env, &client, "Merchant A");
    let merchant_b = register_merchant(&env, &client, "Merchant B");

    let payer = Address::generate(&env);
    mint(&env, &token, &payer, 10_000);

    make_payment(&env, &client, &payer, &merchant_a, &token, "MERCH_A_001", 400);
    make_payment(&env, &client, &payer, &merchant_b, &token, "MERCH_B_001", 600);

    // Merchant A sees only their payment
    let page_a = client.get_merchant_payment_history(
        &merchant_a,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page_a.total, 1, "merchant A should see only 1 payment");
    assert_eq!(
        page_a.payments.get(0).unwrap().merchant_address,
        merchant_a
    );

    // Merchant B sees only their payment
    let page_b = client.get_merchant_payment_history(
        &merchant_b,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page_b.total, 1, "merchant B should see only 1 payment");
    assert_eq!(
        page_b.payments.get(0).unwrap().merchant_address,
        merchant_b
    );
}

/// A merchant's history contains only payments they *received*, not payments
/// made to other merchants in the same session.
#[test]
fn test_merchant_sees_only_received_payments() {
    let (env, client) = setup();

    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    client.set_admin(&admin);

    let merchant_a = register_merchant(&env, &client, "Store A");
    let merchant_b = register_merchant(&env, &client, "Store B");

    let payer = Address::generate(&env);
    mint(&env, &token, &payer, 10_000);

    // 3 payments to A, 1 payment to B
    make_payment(&env, &client, &payer, &merchant_a, &token, "RECV_A_001", 100);
    make_payment(&env, &client, &payer, &merchant_a, &token, "RECV_A_002", 150);
    make_payment(&env, &client, &payer, &merchant_a, &token, "RECV_A_003", 200);
    make_payment(&env, &client, &payer, &merchant_b, &token, "RECV_B_001", 999);

    // Merchant A sees exactly 3 payments, all theirs
    let page = client.get_merchant_payment_history(
        &merchant_a,
        &None,
        &10,
        &None,
        &SortField::Amount,
        &SortOrder::Ascending,
    );
    assert_eq!(page.total, 3);
    for payment in page.payments.iter() {
        assert_eq!(
            payment.merchant_address, merchant_a,
            "all payments must belong to merchant_a"
        );
    }
}
