#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Bytes, Env, String, Vec,
};

use crate::{
    error::PaymentError,
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

// ── Global stats tests ────────────────────────────────────────────────────────

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

// ── Error variant coverage (Issue #33) ───────────────────────────────────────

mod error_cases {
    use super::*;

    // Auth errors

    #[test]
    fn test_error_admin_already_set() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.set_admin(&admin);
        assert_eq!(
            client.try_set_admin(&admin),
            Err(Ok(PaymentError::AdminAlreadySet))
        );
    }

    #[test]
    fn test_error_invalid_admin_address() {
        let (env, client) = setup();
        let contract_addr = env.register(PaymentProcessingContract, ());
        assert_eq!(
            client.try_set_admin(&contract_addr),
            Err(Ok(PaymentError::InvalidAdminAddress))
        );
    }

    #[test]
    fn test_error_unauthorized_get_payment() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        make_payment(&env, &client, &merchant, &payer, &token, "AUTH_001", 100);
        let stranger = Address::generate(&env);
        assert_eq!(
            client.try_get_payment_by_id(&stranger, &str(&env, "AUTH_001")),
            Err(Ok(PaymentError::Unauthorized))
        );
    }

    // Merchant errors

    #[test]
    fn test_error_merchant_not_found() {
        let (env, client) = setup();
        let unknown = Address::generate(&env);
        assert_eq!(
            client.try_get_merchant(&unknown),
            Err(Ok(PaymentError::MerchantNotFound))
        );
    }

    #[test]
    fn test_error_merchant_already_registered() {
        let (env, client) = setup();
        let merchant = Address::generate(&env);
        client.register_merchant(
            &merchant,
            &str(&env, "Store"),
            &str(&env, ""),
            &str(&env, ""),
            &MerchantCategory::Other,
        );
        assert_eq!(
            client.try_register_merchant(
                &merchant,
                &str(&env, "Store"),
                &str(&env, ""),
                &str(&env, ""),
                &MerchantCategory::Other,
            ),
            Err(Ok(PaymentError::MerchantAlreadyRegistered))
        );
    }

    #[test]
    fn test_error_merchant_inactive() {
        let (env, client, admin, merchant, payer, token) = setup_payment_env();
        client.deactivate_merchant(&admin, &merchant);
        assert_eq!(
            client.try_process_payment_with_signature(
                &payer,
                &str(&env, "INACT_001"),
                &merchant,
                &token,
                &100,
                &str(&env, ""),
                &None,
                &bytes(&env, &[0u8; 64]),
                &bytes(&env, &[0u8; 32]),
            ),
            Err(Ok(PaymentError::MerchantInactive))
        );
    }

    // Payment errors

    #[test]
    fn test_error_payment_not_found() {
        let (env, client, _admin, _merchant, payer, _token) = setup_payment_env();
        assert_eq!(
            client.try_get_payment_by_id(&payer, &str(&env, "NOPE")),
            Err(Ok(PaymentError::PaymentNotFound))
        );
    }

    #[test]
    fn test_error_payment_already_exists() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        make_payment(&env, &client, &merchant, &payer, &token, "DUP_001", 100);
        assert_eq!(
            client.try_process_payment_with_signature(
                &payer,
                &str(&env, "DUP_001"),
                &merchant,
                &token,
                &100,
                &str(&env, ""),
                &None,
                &bytes(&env, &[0u8; 64]),
                &bytes(&env, &[0u8; 32]),
            ),
            Err(Ok(PaymentError::PaymentAlreadyExists))
        );
    }

    #[test]
    fn test_error_invalid_amount_zero() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        assert_eq!(
            client.try_process_payment_with_signature(
                &payer,
                &str(&env, "ZERO_001"),
                &merchant,
                &token,
                &0,
                &str(&env, ""),
                &None,
                &bytes(&env, &[0u8; 64]),
                &bytes(&env, &[0u8; 32]),
            ),
            Err(Ok(PaymentError::InvalidAmount))
        );
    }

    #[test]
    fn test_error_invalid_amount_negative() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        assert_eq!(
            client.try_process_payment_with_signature(
                &payer,
                &str(&env, "NEG_001"),
                &merchant,
                &token,
                &-1,
                &str(&env, ""),
                &None,
                &bytes(&env, &[0u8; 64]),
                &bytes(&env, &[0u8; 32]),
            ),
            Err(Ok(PaymentError::InvalidAmount))
        );
    }

    // Refund errors

    #[test]
    fn test_error_refund_not_found() {
        let (env, client) = setup();
        assert_eq!(
            client.try_get_refund(&str(&env, "NOPE")),
            Err(Ok(PaymentError::RefundNotFound))
        );
    }

    #[test]
    fn test_error_refund_already_exists() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        make_payment(&env, &client, &merchant, &payer, &token, "REF_DUP", 500);
        client.initiate_refund(
            &payer,
            &str(&env, "REFDUP_001"),
            &str(&env, "REF_DUP"),
            &100,
            &str(&env, "reason"),
        );
        assert_eq!(
            client.try_initiate_refund(
                &payer,
                &str(&env, "REFDUP_001"),
                &str(&env, "REF_DUP"),
                &100,
                &str(&env, "reason"),
            ),
            Err(Ok(PaymentError::RefundAlreadyExists))
        );
    }

    #[test]
    fn test_error_refund_window_expired() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        make_payment(&env, &client, &merchant, &payer, &token, "REF_EXP", 500);
        env.ledger().with_mut(|l| l.timestamp += 31 * 24 * 3600);
        assert_eq!(
            client.try_initiate_refund(
                &payer,
                &str(&env, "REFEXP_001"),
                &str(&env, "REF_EXP"),
                &100,
                &str(&env, "late"),
            ),
            Err(Ok(PaymentError::RefundWindowExpired))
        );
    }

    #[test]
    fn test_error_refund_exceeds_original() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        make_payment(&env, &client, &merchant, &payer, &token, "REF_OVR", 200);
        assert_eq!(
            client.try_initiate_refund(
                &payer,
                &str(&env, "REFOVR_001"),
                &str(&env, "REF_OVR"),
                &300,
                &str(&env, "too much"),
            ),
            Err(Ok(PaymentError::RefundExceedsOriginal))
        );
    }

    #[test]
    fn test_error_refund_not_approved() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        make_payment(&env, &client, &merchant, &payer, &token, "REF_NAPR", 500);
        client.initiate_refund(
            &payer,
            &str(&env, "REFNAPR_001"),
            &str(&env, "REF_NAPR"),
            &100,
            &str(&env, "reason"),
        );
        // Execute without approval
        assert_eq!(
            client.try_execute_refund(&str(&env, "REFNAPR_001")),
            Err(Ok(PaymentError::RefundNotApproved))
        );
    }

    #[test]
    fn test_error_refund_already_completed() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        make_payment(&env, &client, &merchant, &payer, &token, "REF_COMP", 500);
        client.initiate_refund(
            &payer,
            &str(&env, "REFCOMP_001"),
            &str(&env, "REF_COMP"),
            &100,
            &str(&env, "reason"),
        );
        client.approve_refund(&merchant, &str(&env, "REFCOMP_001"));
        // Approve again on an already-approved refund
        assert_eq!(
            client.try_approve_refund(&merchant, &str(&env, "REFCOMP_001")),
            Err(Ok(PaymentError::RefundAlreadyCompleted))
        );
    }

    // Multisig errors

    #[test]
    fn test_error_multisig_not_found() {
        let (env, client) = setup();
        let signer = Address::generate(&env);
        assert_eq!(
            client.try_sign_multisig_payment(
                &signer,
                &str(&env, "NOPE"),
                &bytes(&env, &[0u8; 64]),
            ),
            Err(Ok(PaymentError::MultisigNotFound))
        );
    }

    #[test]
    fn test_error_multisig_already_signed() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        let signer = Address::generate(&env);
        let mut signers = Vec::new(&env);
        signers.push_back(signer.clone());
        signers.push_back(Address::generate(&env));

        client.initiate_multisig_payment(
            &payer,
            &str(&env, "MS_ERR_001"),
            &merchant,
            &token,
            &500,
            &signers,
            &2,
        );
        client.sign_multisig_payment(&signer, &str(&env, "MS_ERR_001"), &bytes(&env, &[1u8; 64]));
        assert_eq!(
            client.try_sign_multisig_payment(
                &signer,
                &str(&env, "MS_ERR_001"),
                &bytes(&env, &[1u8; 64]),
            ),
            Err(Ok(PaymentError::MultisigAlreadySigned))
        );
    }

    #[test]
    fn test_error_multisig_already_executed() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        let signer = Address::generate(&env);
        let mut signers = Vec::new(&env);
        signers.push_back(signer.clone());

        client.initiate_multisig_payment(
            &payer,
            &str(&env, "MS_ERR_002"),
            &merchant,
            &token,
            &500,
            &signers,
            &1,
        );
        client.sign_multisig_payment(&signer, &str(&env, "MS_ERR_002"), &bytes(&env, &[1u8; 64]));
        client.execute_multisig_payment(&payer, &str(&env, "MS_ERR_002"));
        assert_eq!(
            client.try_execute_multisig_payment(&payer, &str(&env, "MS_ERR_002")),
            Err(Ok(PaymentError::MultisigAlreadyExecuted))
        );
    }

    #[test]
    fn test_error_insufficient_signatures() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        let signer = Address::generate(&env);
        let mut signers = Vec::new(&env);
        signers.push_back(signer.clone());

        client.initiate_multisig_payment(
            &payer,
            &str(&env, "MS_ERR_003"),
            &merchant,
            &token,
            &500,
            &signers,
            &2,
        );
        // Only 1 signature, need 2
        client.sign_multisig_payment(&signer, &str(&env, "MS_ERR_003"), &bytes(&env, &[1u8; 64]));
        assert_eq!(
            client.try_execute_multisig_payment(&payer, &str(&env, "MS_ERR_003")),
            Err(Ok(PaymentError::InsufficientSignatures))
        );
    }

    // General errors

    #[test]
    fn test_error_invalid_input_empty_order_id() {
        let (env, client, _admin, merchant, payer, token) = setup_payment_env();
        assert_eq!(
            client.try_process_payment_with_signature(
                &payer,
                &str(&env, ""),
                &merchant,
                &token,
                &100,
                &str(&env, ""),
                &None,
                &bytes(&env, &[0u8; 64]),
                &bytes(&env, &[0u8; 32]),
            ),
            Err(Ok(PaymentError::InvalidInput))
        );
    }

    #[test]
    fn test_error_pagination_limit_exceeded() {
        let (env, client, _admin, merchant, _payer, _token) = setup_payment_env();
        assert_eq!(
            client.try_get_merchant_payment_history(
                &merchant,
                &None,
                &101,
                &None,
                &SortField::Date,
                &SortOrder::Ascending,
            ),
            Err(Ok(PaymentError::PaginationLimitExceeded))
        );
    }

    #[test]
    fn test_error_batch_size_exceeded() {
        let (env, client, _admin, merchant, _payer, token) = setup_payment_env();
        let mut payments = Vec::new(&env);
        for _ in 0..11 {
            payments.push_back(BatchPaymentItem {
                order_id: str(&env, "X"),
                merchant_address: merchant.clone(),
                token_address: token.clone(),
                amount: 1,
                memo: str(&env, ""),
                signature: bytes(&env, &[0u8; 64]),
                merchant_public_key: bytes(&env, &[0u8; 32]),
            });
        }
        assert_eq!(
            client.try_batch_payment(&merchant, &payments),
            Err(Ok(PaymentError::BatchSizeExceeded))
        );
    }
}
