#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Bytes, Env, String, Vec,
};

use crate::{
    error::PaymentError,
    storage,
    types::{BatchPaymentItem, MerchantCategory, PaymentFilter, SortField, SortOrder, StatusFilter},
    PaymentProcessingContract, PaymentProcessingContractClient,
};

// ── Test helpers ──────────────────────────────────────────────────────────────

fn setup() -> (Env, PaymentProcessingContractClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);
    (env, client)
}

#[test]
fn test_nonce_increment_and_replay_rejection() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    // Initial nonce should be 0
    let n0 = crate::storage::get_payer_nonce(&env, &payer);
    assert_eq!(n0, 0u64);

    // Submit a payment with nonce 0
    client.process_payment_with_nonce(
        &payer,
        &str(&env, "NONCE_ORDER_1"),
        &merchant,
        &token,
        &100,
        &str(&env, ""),
        &None,
        &0u64,
    );

    // Nonce should have incremented to 1
    let n1 = crate::storage::get_payer_nonce(&env, &payer);
    assert_eq!(n1, 1u64);

    // Replay with same nonce should fail
    let result = client.try_process_payment_with_nonce(
        &payer,
        &str(&env, "NONCE_ORDER_2"),
        &merchant,
        &token,
        &50,
        &str(&env, ""),
        &None,
        &0u64,
    );
    assert_eq!(result, Err(Ok(crate::error::PaymentError::InvalidNonce)));
}

fn create_token(env: &Env, admin: &Address) -> Address {
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    token_id.address()
}

fn mint(env: &Env, token: &Address, _admin: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

fn str(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn bytes(env: &Env, data: &[u8]) -> Bytes {
    Bytes::from_slice(env, data)
}

// ── Admin tests ───────────────────────────────────────────────────────────────

#[test]
fn test_set_admin_success() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
}

#[test]
fn test_set_admin_twice_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    let result = client.try_set_admin(&admin);
    assert_eq!(result, Err(Ok(PaymentError::AdminAlreadySet)));
}

#[test]
fn test_set_admin_zero_address_fails() {
    let (env, client) = setup();
    // In Soroban, we can test this by trying to set a contract address as admin
    let contract_address = env.register(PaymentProcessingContract, ());
    let result = client.try_set_admin(&contract_address);
    assert_eq!(result, Err(Ok(PaymentError::InvalidAdminAddress)));
}

// ── Merchant tests ────────────────────────────────────────────────────────────

#[test]
fn test_register_merchant_success() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    client.register_merchant(
        &merchant,
        &str(&env, "My Store"),
        &str(&env, "A great store"),
        &str(&env, "contact@store.com"),
        &MerchantCategory::Retail,
    );
    let m = client.get_merchant(&merchant);
    assert_eq!(m.name, str(&env, "My Store"));
    assert!(m.active);
}

#[test]
fn test_register_merchant_duplicate_fails() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Other,
    );
    let result = client.try_register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Other,
    );
    assert_eq!(result, Err(Ok(PaymentError::MerchantAlreadyRegistered)));
}

#[test]
fn test_deactivate_merchant() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    client.set_admin(&admin);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Retail,
    );
    client.deactivate_merchant(&admin, &merchant);
    let m = client.get_merchant(&merchant);
    assert!(!m.active);
}

// ── Payment tests ─────────────────────────────────────────────────────────────

fn setup_payment_env() -> (
    Env,
    PaymentProcessingContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
) {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);

    client.set_admin(&admin);
    client.add_allowed_token(&admin, &token);
    client.register_merchant(
        &merchant,
        &str(&env, "Shop"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Retail,
    );
    mint(&env, &token, &token_admin, &payer, 10_000);

    (env, client, admin, merchant, payer, token)
}

#[test]
fn test_successful_payment_with_signature() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    // Dummy public key and signature (mock_all_auths bypasses crypto)
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    client.process_payment_with_signature(
        &payer,
        &str(&env, "ORDER_001"),
        &merchant,
        &token,
        &1_000,
        &str(&env, "Test payment"),
        &None,
        &sig,
        &pub_key,
    );

    let payment = client.get_payment_by_id(&payer, &str(&env, "ORDER_001"));
    assert_eq!(payment.amount, 1_000);
}

#[test]
fn test_duplicate_order_id_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    client.process_payment_with_signature(
        &payer,
        &str(&env, "ORDER_DUP"),
        &merchant,
        &token,
        &500,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );

    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "ORDER_DUP"),
        &merchant,
        &token,
        &500,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::PaymentAlreadyExists)));
}

#[test]
fn test_payment_inactive_merchant_fails() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    client.deactivate_merchant(&admin, &merchant);

    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "ORDER_X"),
        &merchant,
        &token,
        &100,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::MerchantInactive)));
}

// ── Refund tests ──────────────────────────────────────────────────────────────

fn make_payment(
    env: &Env,
    client: &PaymentProcessingContractClient,
    merchant: &Address,
    payer: &Address,
    token: &Address,
    order_id: &str,
    amount: i128,
) {
    let pub_key = bytes(env, &[0u8; 32]);
    let sig = bytes(env, &[0u8; 64]);
    client.process_payment_with_signature(
        payer,
        &str(env, order_id),
        merchant,
        token,
        &amount,
        &str(env, ""),
        &None,
        &sig,
        &pub_key,
    );
}

#[test]
fn test_batch_payment_success() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    
    let ids = ["B1", "B2", "B3"];
    let mut payments = Vec::new(&env);
    for id_str in ids {
        payments.push_back(BatchPaymentItem {
            order_id: str(&env, id_str),
            merchant_address: merchant.clone(),
            token_address: token.clone(),
            amount: 100,
            memo: str(&env, ""),
            signature: bytes(&env, &[0u8; 64]),
            merchant_public_key: bytes(&env, &[0u8; 32]),
        });
    }

    client.batch_payment(&payer, &payments);

    // Verify all recorded
    for id_str in ids {
        let p = client.get_payment_by_id(&payer, &str(&env, id_str));
        assert_eq!(p.order_id, str(&env, id_str));
    }
}

#[test]
fn test_batch_payment_size_exceeded() {
    let (env, client, _admin, merchant, _payer, token) = setup_payment_env();
    let mut payments = Vec::new(&env);
    for _ in 0..11 {
        payments.push_back(BatchPaymentItem {
            order_id: str(&env, "B"),
            merchant_address: merchant.clone(),
            token_address: token.clone(),
            amount: 100,
            memo: str(&env, ""),
            signature: bytes(&env, &[0u8; 64]),
            merchant_public_key: bytes(&env, &[0u8; 32]),
        });
    }
    let result = client.try_batch_payment(&merchant, &payments);
    assert_eq!(result, Err(Ok(PaymentError::BatchSizeExceeded)));
}

#[test]
fn test_batch_payment_atomic_failure() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    
    let mut payments = Vec::new(&env);
    // 1st item: valid
    payments.push_back(BatchPaymentItem {
        order_id: str(&env, "BATCH_OK"),
        merchant_address: merchant.clone(),
        token_address: token.clone(),
        amount: 100,
        memo: str(&env, ""),
        signature: bytes(&env, &[0u8; 64]),
        merchant_public_key: bytes(&env, &[0u8; 32]),
    });
    // 2nd item: invalid (negative amount)
    payments.push_back(BatchPaymentItem {
        order_id: str(&env, "BATCH_FAIL"),
        merchant_address: merchant.clone(),
        token_address: token.clone(),
        amount: -1,
        memo: str(&env, ""),
        signature: bytes(&env, &[0u8; 64]),
        merchant_public_key: bytes(&env, &[0u8; 32]),
    });

    let result = client.try_batch_payment(&payer, &payments);
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));

    // Verify 1st item was NOT recorded (atomicity)
    let check = client.get_payer_payment_history(&payer, &None, &10, &None, &SortField::Date, &SortOrder::Ascending);
    assert_eq!(check.total, 0);
}

#[test]
fn test_successful_refund_flow() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_R1", 1_000);

    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_001"),
        &str(&env, "ORDER_R1"),
        &500,
        &str(&env, "Customer request"),
    );
    client.approve_refund(&merchant, &str(&env, "REFUND_001"));
    client.execute_refund(&str(&env, "REFUND_001"));

    let refund = client.get_refund(&str(&env, "REFUND_001"));
    assert!(matches!(refund.status, crate::types::RefundStatus::Completed));
}

#[test]
fn test_refund_exceeds_original_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_R2", 500);

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "REFUND_002"),
        &str(&env, "ORDER_R2"),
        &600,
        &str(&env, "Too much"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundExceedsOriginal)));
}

#[test]
fn test_refund_window_expired_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_R3", 1_000);

    // Advance ledger past 30-day window
    env.ledger().with_mut(|l| {
        l.timestamp += 31 * 24 * 3600;
    });

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "REFUND_003"),
        &str(&env, "ORDER_R3"),
        &100,
        &str(&env, "Late"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundWindowExpired)));
}

#[test]
fn test_reject_refund() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_R4", 1_000);

    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_004"),
        &str(&env, "ORDER_R4"),
        &200,
        &str(&env, "Reason"),
    );
    client.reject_refund(&merchant, &str(&env, "REFUND_004"));

    let refund = client.get_refund(&str(&env, "REFUND_004"));
    assert!(matches!(refund.status, crate::types::RefundStatus::Rejected));
}

#[test]
fn test_multiple_sequential_partial_refunds() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    // Make a payment of 1000
    make_payment(&env, &client, &merchant, &payer, &token, "SEQ_REFUND", 1_000);

    // First partial refund 400
    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_SEQ_1"),
        &str(&env, "SEQ_REFUND"),
        &400,
        &str(&env, "First partial"),
    );
    client.approve_refund(&merchant, &str(&env, "REFUND_SEQ_1"));
    client.execute_refund(&str(&env, "REFUND_SEQ_1"));

    // Second partial refund 600 -> should reach full refund
    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_SEQ_2"),
        &str(&env, "SEQ_REFUND"),
        &600,
        &str(&env, "Second partial"),
    );
    client.approve_refund(&merchant, &str(&env, "REFUND_SEQ_2"));
    client.execute_refund(&str(&env, "REFUND_SEQ_2"));

    // Payment should be fully refunded
    let p = client.get_payment_by_id(&payer, &str(&env, "SEQ_REFUND"));
    assert!(matches!(p.status, crate::types::PaymentStatus::FullyRefunded));

    // Third refund attempt should fail with RefundExceedsOriginal
    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "REFUND_SEQ_3"),
        &str(&env, "SEQ_REFUND"),
        &1,
        &str(&env, "Too late"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundExceedsOriginal)));

    // Archive the payment record and verify refund after archive returns PaymentNotFound
    client.archive_payment_record(&admin, &str(&env, "SEQ_REFUND"));
    let result2 = client.try_initiate_refund(
        &payer,
        &str(&env, "REFUND_SEQ_4"),
        &str(&env, "SEQ_REFUND"),
        &1,
        &str(&env, "After archive"),
    );
    assert_eq!(result2, Err(Ok(PaymentError::PaymentNotFound)));
}

// ── Payment history tests ─────────────────────────────────────────────────────

#[test]
fn test_get_merchant_payment_history() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "H_001", 100);
    make_payment(&env, &client, &merchant, &payer, &token, "H_002", 200);
    make_payment(&env, &client, &merchant, &payer, &token, "H_003", 300);

    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &None,
        &SortField::Amount,
        &SortOrder::Ascending,
    );
    assert_eq!(page.total, 3);
    assert_eq!(page.payments.get(0).unwrap().amount, 100);
    assert_eq!(page.payments.get(2).unwrap().amount, 300);
}

#[test]
fn test_get_payer_payment_history_with_filter() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "P_001", 50);
    make_payment(&env, &client, &merchant, &payer, &token, "P_002", 500);
    make_payment(&env, &client, &merchant, &payer, &token, "P_003", 1_500);

    let filter = PaymentFilter {
        date_start: None,
        date_end: None,
        amount_min: Some(100),
        amount_max: Some(1_000),
        token: None,
        status: StatusFilter::Any,
        tag: None,
    };

    let page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &Some(filter),
        &SortField::Amount,
        &SortOrder::Descending,
    );
    assert_eq!(page.total, 1);
    assert_eq!(page.payments.get(0).unwrap().amount, 500);
}

#[test]
fn test_pagination_limit() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let ids = ["PAG_0", "PAG_1", "PAG_2", "PAG_3", "PAG_4"];
    for id_str in ids {
        let id = String::from_str(&env, id_str);
        let pub_key = bytes(&env, &[0u8; 32]);
        let sig = bytes(&env, &[0u8; 64]);
        client.process_payment_with_signature(
            &payer, id, &merchant, &token, &100, &str(&env, ""), &sig, &pub_key,
        );
    }

    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &3,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page.payments.len(), 3);
    assert!(page.next_cursor.is_some());
}

// ── Refund rate limit tests ───────────────────────────────────────────────────

#[test]
fn test_refund_rate_limit_enforced() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "RL_001", 10_000);

    // Default limit is 5; initiate 5 refunds successfully
    for rid in ["R0", "R1", "R2", "R3", "R4"] {
        client.initiate_refund(&payer, &str(&env, rid), &str(&env, "RL_001"), &100, &str(&env, "reason"));
    }

    // 6th must fail
    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "R5"),
        &str(&env, "RL_001"),
        &100,
        &str(&env, "reason"),
    );
    assert_eq!(result, Err(Ok(PaymentError::TooManyRefunds)));

    // Admin raises limit — next call succeeds
    client.set_max_refunds_per_order(&admin, &10);
    client.initiate_refund(&payer, &str(&env, "R5"), &str(&env, "RL_001"), &100, &str(&env, "reason"));
}

#[test]
fn test_refund_rate_limit_boundary() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "RL_002", 10_000);

    // Set limit to 2
    client.set_max_refunds_per_order(&admin, &2);

    client.initiate_refund(&payer, &str(&env, "RA"), &str(&env, "RL_002"), &100, &str(&env, "r"));
    client.initiate_refund(&payer, &str(&env, "RB"), &str(&env, "RL_002"), &100, &str(&env, "r"));

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "RC"),
        &str(&env, "RL_002"),
        &100,
        &str(&env, "r"),
    );
    assert_eq!(result, Err(Ok(PaymentError::TooManyRefunds)));
}

// ── Multisig tests ────────────────────────────────────────────────────────────

#[test]
fn test_initiate_multisig_payment_success() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_001"),
        &merchant,
        &token,
        &1_000,
        &signers,
        &2,
    );

    client.sign_multisig_payment(&signer1, &str(&env, "MS_001"), &bytes(&env, &[1u8; 64]));
    client.sign_multisig_payment(&signer2, &str(&env, "MS_001"), &bytes(&env, &[2u8; 64]));
    client.execute_multisig_payment(&payer, &str(&env, "MS_001"));
}

#[test]
fn test_multisig_insufficient_signatures_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_002"),
        &merchant,
        &token,
        &500,
        &signers,
        &2,
    );

    client.sign_multisig_payment(&signer1, &str(&env, "MS_002"), &bytes(&env, &[1u8; 64]));

    let result = client.try_execute_multisig_payment(&payer, &str(&env, "MS_002"));
    assert_eq!(result, Err(Ok(PaymentError::InsufficientSignatures)));
}

#[test]
fn test_multisig_payment_appears_in_history() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_HIST"),
        &merchant,
        &token,
        &1_000,
        &signers,
        &2,
    );
    client.sign_multisig_payment(&signer1, &str(&env, "MS_HIST"), &bytes(&env, &[1u8; 64]));
    client.sign_multisig_payment(&signer2, &str(&env, "MS_HIST"), &bytes(&env, &[2u8; 64]));
    client.execute_multisig_payment(&payer, &str(&env, "MS_HIST"));

    // Verify payment appears in merchant history
    let merchant_page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Descending,
    );
    assert_eq!(merchant_page.payments.len(), 1);
    assert_eq!(merchant_page.payments.get(0).unwrap().order_id, str(&env, "MS_HIST"));

    // Verify payment appears in payer history
    let payer_page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Descending,
    );
    assert_eq!(payer_page.payments.len(), 1);
    assert_eq!(payer_page.payments.get(0).unwrap().order_id, str(&env, "MS_HIST"));
}

// ── Global stats tests ────────────────────────────────────────────────────────

#[test]
fn test_deactivate_merchant_decrements_active_stats() {
    let (env, client, admin, merchant, _payer, _token) = setup_payment_env();

    // After setup, 1 merchant is registered → active_merchants = 1
    let stats = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats.active_merchants, 1);

    // Deactivate → active_merchants = 0
    client.deactivate_merchant(&admin, &merchant);
    let stats = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats.active_merchants, 0);
}

#[test]
fn test_deactivate_already_inactive_merchant_no_underflow() {
    let (env, client, admin, merchant, _payer, _token) = setup_payment_env();

    client.deactivate_merchant(&admin, &merchant);
    // Deactivating again must not underflow (stays at 0)
    client.deactivate_merchant(&admin, &merchant);
    let stats = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats.active_merchants, 0);
}

#[test]
fn test_global_stats_updated() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "STAT_001", 1_000);
    make_payment(&env, &client, &merchant, &payer, &token, "STAT_002", 2_000);

    let stats = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats.total_payments, 2);
    assert_eq!(stats.total_volume, 3_000);
    assert_eq!(stats.active_merchants, 1);
}

#[test]
fn test_total_volume_saturates_at_i128_max() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    let mut stats = storage::get_global_stats(&env);
    stats.total_volume = i128::MAX - 500;
    storage::set_global_stats(&env, &stats);

    make_payment(&env, &client, &merchant, &payer, &token, "SATURATE_001", 1_000);

    let stats = storage::get_global_stats(&env);
    assert_eq!(stats.total_volume, i128::MAX);
}

#[test]
fn test_suspicious_activity_event_emitted() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    
    // Set threshold to 500
    client.set_large_payment_threshold(&admin, &500);

    // This payment (1000) should trigger the event
    make_payment(&env, &client, &merchant, &payer, &token, "LARGE_001", 1_000);

    let events = env.events().all();
    let suspicious_event = events.iter().find(|e| {
        e.topics.get(1).unwrap() == soroban_sdk::Symbol::new(&env, "suspicious_activity")
    });
    assert!(suspicious_event.is_some());
}

// ── Cleanup tests ─────────────────────────────────────────────────────────────

#[test]
fn test_cleanup_expired_payments() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "OLD_001", 100);

    // Set short cleanup period (1 second) then advance time
    client.set_payment_cleanup_period(&admin, &1);
    env.ledger().with_mut(|l| l.timestamp += 10);

    let removed = client.cleanup_expired_payments(&admin);
    assert_eq!(removed, 1);
}

// ── Memo / reason length tests ───────────────────────────────────────────────

#[test]
fn test_memo_at_limit_succeeds() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    // 256-char memo — exactly at the limit
    let memo = str(&env, &"a".repeat(256));
    client.process_payment_with_signature(
        &payer,
        &str(&env, "MEMO_OK"),
        &merchant,
        &token,
        &100,
        &memo,
        &None,
        &sig,
        &pub_key,
    );
}

#[test]
fn test_memo_over_limit_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    // 257-char memo — one over the limit
    let memo = str(&env, &"a".repeat(257));
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "MEMO_FAIL"),
        &merchant,
        &token,
        &100,
        &memo,
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_refund_reason_over_limit_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "REASON_ORDER", 500);
    let long_reason = str(&env, &"r".repeat(257));
    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "REASON_REFUND"),
        &str(&env, "REASON_ORDER"),
        &100,
        &long_reason,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_archive_payment_removes_from_index() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ARCH_001", 100);
    make_payment(&env, &client, &merchant, &payer, &token, "ARCH_002", 200);

    // Archive the first payment
    client.archive_payment_record(&admin, &str(&env, "ARCH_001"));

    // Merchant history should only contain ARCH_002
    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page.total, 1);
    assert_eq!(page.payments.get(0).unwrap().order_id, str(&env, "ARCH_002"));

    // Payer history should only contain ARCH_002
    let payer_page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(payer_page.total, 1);
    assert_eq!(payer_page.payments.get(0).unwrap().order_id, str(&env, "ARCH_002"));
}

#[test]
fn test_cleanup_removes_from_index_lists() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "OLD_001", 100);
    make_payment(&env, &client, &merchant, &payer, &token, "OLD_002", 200);

    client.set_payment_cleanup_period(&admin, &1);
    env.ledger().with_mut(|l| l.timestamp += 10);

    // Add a new payment after the cutoff so it stays
    make_payment(&env, &client, &merchant, &payer, &token, "NEW_001", 300);

    let removed = client.cleanup_expired_payments(&admin);
    assert_eq!(removed, 2);

    // History queries should only return the live payment
    let merchant_page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(merchant_page.payments.len(), 1);
    assert_eq!(merchant_page.payments.get(0).unwrap().order_id, str(&env, "NEW_001"));

    let payer_page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(payer_page.payments.len(), 1);
    assert_eq!(payer_page.payments.get(0).unwrap().order_id, str(&env, "NEW_001"));
}

#[test]
fn test_cleanup_period_set_event() {
    let (env, client, admin, _, _, _) = setup_payment_env();
    client.set_payment_cleanup_period(&admin, &86400);
    let events = env.events().all();
    let event = events.iter().find(|e| {
        e.topics.get(1).unwrap() == soroban_sdk::Symbol::new(&env, "cleanup_period_set")
    });
    assert!(event.is_some());
}

#[test]
fn test_is_registered() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    
    assert!(!client.is_registered(&merchant));
    
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Other,
    );
    
    assert!(client.is_registered(&merchant));
}

// ── Auth rejection tests (#90) ────────────────────────────────────────────────

#[test]
fn test_auth_set_payment_cleanup_period_requires_admin() {
    let (env, client, _admin, _, _, _) = setup_payment_env();
    let non_admin = Address::generate(&env);
    let result = client.try_set_payment_cleanup_period(&non_admin, &86400);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_auth_set_large_payment_threshold_requires_admin() {
    let (env, client, _admin, _, _, _) = setup_payment_env();
    let non_admin = Address::generate(&env);
    let result = client.try_set_large_payment_threshold(&non_admin, &1000);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_auth_deactivate_merchant_requires_admin() {
    let (env, client, _admin, merchant, _, _) = setup_payment_env();
    let non_admin = Address::generate(&env);
    let result = client.try_deactivate_merchant(&non_admin, &merchant);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_auth_verify_merchant_requires_admin() {
    let (env, client, _admin, merchant, _, _) = setup_payment_env();
    let non_admin = Address::generate(&env);
    let result = client.try_verify_merchant(&non_admin, &merchant);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_auth_archive_payment_requires_admin() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "AUTH_PAY", 100);
    let non_admin = Address::generate(&env);
    let result = client.try_archive_payment_record(&non_admin, &str(&env, "AUTH_PAY"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_auth_cleanup_expired_payments_requires_admin() {
    let (env, client, _admin, _, _, _) = setup_payment_env();
    let non_admin = Address::generate(&env);
    let result = client.try_cleanup_expired_payments(&non_admin);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_auth_get_global_stats_requires_admin() {
    let (env, client, _admin, _, _, _) = setup_payment_env();
    let non_admin = Address::generate(&env);
    let result = client.try_get_global_payment_stats(&non_admin, &None, &None);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_auth_get_payment_by_id_requires_participant() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "AUTH_P2", 100);
    let stranger = Address::generate(&env);
    let result = client.try_get_payment_by_id(&stranger, &str(&env, "AUTH_P2"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_auth_approve_refund_requires_admin_or_merchant() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "AUTH_R", 1_000);
    client.initiate_refund(&payer, &str(&env, "AUTH_RF"), &str(&env, "AUTH_R"), &100, &str(&env, "r"));
    let stranger = Address::generate(&env);
    let result = client.try_approve_refund(&stranger, &str(&env, "AUTH_RF"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_auth_reject_refund_requires_admin_or_merchant() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "AUTH_R2", 1_000);
    client.initiate_refund(&payer, &str(&env, "AUTH_RF2"), &str(&env, "AUTH_R2"), &100, &str(&env, "r"));
    let stranger = Address::generate(&env);
    let result = client.try_reject_refund(&stranger, &str(&env, "AUTH_RF2"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_auth_initiate_refund_requires_payer_or_merchant() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "AUTH_R3", 1_000);
    let stranger = Address::generate(&env);
    let result = client.try_initiate_refund(
        &stranger,
        &str(&env, "AUTH_RF3"),
        &str(&env, "AUTH_R3"),
        &100,
        &str(&env, "r"),
    );
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_auth_sign_multisig_requires_listed_signer() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());
    client.initiate_multisig_payment(&payer, &str(&env, "AUTH_MS"), &merchant, &token, &500, &signers, &1);
    let stranger = Address::generate(&env);
    let result = client.try_sign_multisig_payment(&stranger, &str(&env, "AUTH_MS"), &bytes(&env, &[0u8; 64]));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}
