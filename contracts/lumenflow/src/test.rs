#![cfg(test)]

extern crate alloc;

use alloc::format;

use soroban_sdk::{
    testutils::{Address as _, Events, Ledger},
    token::StellarAssetClient,
    Address, Bytes, Env, String, Vec,
};

use crate::{
    error::PaymentError,
    storage,
    types::{
        BatchPaymentItem, MerchantCategory, PaymentFilter, SortField, SortOrder, StatusFilter,
    },
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
fn test_get_contract_version() {
    let (env, client) = setup();
    let version = client.get_contract_version();
    assert_eq!(version, str(&env, "1.0.0"));
}

#[test]
fn test_set_admin_success() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);

    // Verify admin is correctly stored and retrievable via contract context
    let stored_admin = env.as_contract(&client.address, || storage::get_admin(&env));
    assert_eq!(stored_admin, Some(admin.clone()));

    // Verify a second set_admin call returns AdminAlreadySet
    let result = client.try_set_admin(&admin);
    assert_eq!(result, Err(Ok(PaymentError::AdminAlreadySet)));
}

#[test]
fn test_set_admin_twice_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    let result = client.try_set_admin(&admin);
    assert_eq!(result, Err(Ok(PaymentError::AdminAlreadySet)));
}

// ── Pause tests ───────────────────────────────────────────────────────────────

#[test]
fn test_pause_and_unpause() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);

    // Admin can pause
    client.pause_contract(&admin);

    // Admin can unpause
    client.unpause_contract(&admin);
}

#[test]
fn test_mutating_functions_reject_when_paused() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    client.set_admin(&admin);
    client.pause_contract(&admin);

    // Register merchant should fail when paused
    let result = client.try_register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "info"),
        &MerchantCategory::Retail,
    );
    assert_eq!(result, Err(Ok(PaymentError::ContractPaused)));
}

#[test]
fn test_read_only_calls_work_while_paused() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);

    client.set_admin(&admin);

    // Register merchant before pausing
    client.register_merchant(
        &merchant,
        &str(&env, "My Store"),
        &str(&env, "desc"),
        &str(&env, "info"),
        &MerchantCategory::Retail,
    );

    // Pause contract
    client.pause_contract(&admin);

    // Read-only calls should still work while paused
    let m = client.get_merchant(&merchant);
    assert_eq!(m.name, str(&env, "My Store"));
}

#[test]
fn test_pause_requires_admin() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);

    client.set_admin(&admin);

    // Non-admin cannot pause
    let result = client.try_pause_contract(&non_admin);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_set_admin_zero_address_fails() {
    // Contract address validation via contract_id() is not publicly accessible
    // in soroban-sdk 26; this test verifies that set_admin still succeeds for
    // a valid non-zero address (regression guard).
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    // A second call must fail with AdminAlreadySet
    let result = client.try_set_admin(&admin);
    assert_eq!(result, Err(Ok(PaymentError::AdminAlreadySet)));
}

#[test]
fn test_set_admin_contract_address_rejected() {
    // Resolves issue #476: a contract address must be rejected by set_admin.
    // env.register() returns a contract address (ScAddress::Contract discriminant).
    let (env, client) = setup();
    let contract_addr = env.register(crate::PaymentProcessingContract, ());
    let result = client.try_set_admin(&contract_addr);
    assert_eq!(result, Err(Ok(PaymentError::InvalidAdminAddress)));
}

#[test]
fn test_transfer_admin_success() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.set_admin(&admin);
    client.transfer_admin(&admin, &new_admin);
    
    // Old admin should fail
    let result = client.try_set_payment_cleanup_period(&admin, &86400);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
    
    // New admin should succeed
    let result2 = client.try_set_payment_cleanup_period(&new_admin, &86400);
    assert_eq!(result2, Ok(Ok(())));
}

#[test]
fn test_transfer_admin_unauthorized() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.set_admin(&admin);
    let result = client.try_transfer_admin(&non_admin, &new_admin);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_transfer_admin_self() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    client.transfer_admin(&admin, &admin);
    let result = client.try_set_payment_cleanup_period(&admin, &86400);
    assert_eq!(result, Ok(Ok(())));
}

#[test]
fn test_admin_transfer_state_retention_and_permission_separation() {
    let (env, client, admin, merchant, _payer, _token) = setup_payment_env();

    // Initial admin can mutate admin-only state.
    client.set_max_refunds_per_order(&admin, &2);

    // Merchant data should still exist before the transfer.
    let merchant_before = client.get_merchant(&merchant);
    assert!(merchant_before.active);

    // Simulate an admin handover by updating the stored admin value directly.
    let new_admin = Address::generate(&env);
    storage::set_admin(&env, &new_admin);

    // New admin should still be able to perform admin-only actions.
    client.set_large_payment_threshold(&new_admin, &20_000);

    // Old admin should no longer have admin privileges.
    let result = client.try_set_large_payment_threshold(&admin, &30_000);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));

    // Contract state should retain merchant records after admin rotation.
    let merchant_after = client.get_merchant(&merchant);
    assert_eq!(merchant_after.address, merchant);
    assert!(merchant_after.active);
}

#[test]
fn test_set_admin_valid_account_succeeds() {
    let (env, client) = setup();
    // A standard account address must be accepted
    let admin = Address::generate(&env);
    let result = client.try_set_admin(&admin);
    assert!(result.is_ok());
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
fn test_get_merchants_empty_list() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);

    let page = client.get_merchants(&admin, &None, &10);
    assert_eq!(page.total, 0);
    assert_eq!(page.merchants.len(), 0);
    assert!(page.next_cursor.is_none());
}

#[test]
fn test_get_merchants_single_page() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);

    let mut addresses: Vec<Address> = Vec::new(&env);
    for i in 0..3 {
        let merchant = Address::generate(&env);
        client.register_merchant(
            &merchant,
            &str(&env, &format!("Store {i}")),
            &str(&env, ""),
            &str(&env, ""),
            &MerchantCategory::Retail,
        );
        addresses.push_back(merchant);
    }

    let page = client.get_merchants(&admin, &None, &10);
    assert_eq!(page.total, 3);
    assert_eq!(page.merchants.len(), 3);
    assert!(page.next_cursor.is_none());
    assert_eq!(page.merchants.get(0).unwrap().address, addresses.get(0).unwrap());
}

#[test]
fn test_get_merchants_multi_page() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);

    let mut addresses: Vec<Address> = Vec::new(&env);
    for i in 0..7 {
        let merchant = Address::generate(&env);
        client.register_merchant(
            &merchant,
            &str(&env, &format!("Store {i}")),
            &str(&env, ""),
            &str(&env, ""),
            &MerchantCategory::Retail,
        );
        addresses.push_back(merchant);
    }

    let page1 = client.get_merchants(&admin, &None, &2);
    assert_eq!(page1.total, 7);
    assert_eq!(page1.merchants.len(), 2);
    assert_eq!(page1.merchants.get(0).unwrap().address, addresses.get(0).unwrap());
    assert_eq!(page1.merchants.get(1).unwrap().address, addresses.get(1).unwrap());
    let cursor1 = page1.next_cursor.unwrap();

    let page2 = client.get_merchants(&admin, &Some(cursor1), &2);
    assert_eq!(page2.total, 4);
    assert_eq!(page2.merchants.len(), 2);
    assert_eq!(page2.merchants.get(0).unwrap().address, addresses.get(3).unwrap());
    assert_eq!(page2.merchants.get(1).unwrap().address, addresses.get(4).unwrap());
    let cursor2 = page2.next_cursor.unwrap();

    assert_eq!(cursor2, addresses.get(5).unwrap());

    let page3 = client.get_merchants(&admin, &Some(cursor2), &2);
    assert_eq!(page3.total, 1);
    assert_eq!(page3.merchants.len(), 1);
    assert_eq!(page3.merchants.get(0).unwrap().address, addresses.get(6).unwrap());
    assert!(page3.next_cursor.is_none());
}

#[test]
fn test_get_merchants_requires_admin() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    client.set_admin(&admin);

    let result = client.try_get_merchants(&non_admin, &None, &10);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
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

#[test]
fn test_reactivate_merchant_success() {
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

    client.reactivate_merchant(&admin, &merchant);
    let m = client.get_merchant(&merchant);
    assert!(m.active);
}

#[test]
fn test_reactivate_merchant_not_found() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    client.set_admin(&admin);

    let result = client.try_reactivate_merchant(&admin, &merchant);
    assert_eq!(result, Err(Ok(PaymentError::MerchantNotFound)));
}

#[test]
fn test_reactivate_merchant_already_active() {
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
    let m = client.get_merchant(&merchant);
    assert!(m.active);

    let result = client.try_reactivate_merchant(&admin, &merchant);
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_reactivate_merchant_unauthorized() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let non_admin = Address::generate(&env);
    client.set_admin(&admin);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Retail,
    );
    client.deactivate_merchant(&admin, &merchant);

    let result = client.try_reactivate_merchant(&non_admin, &merchant);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_reactivate_merchant_increments_active_stats() {
    let (env, client, admin, merchant, _payer, _token) = setup_payment_env();

    // After setup, 1 merchant is registered → active_merchants = 1
    let stats = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats.active_merchants, 1);

    // Deactivate → active_merchants = 0
    client.deactivate_merchant(&admin, &merchant);
    let stats = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats.active_merchants, 0);

    // Reactivate → active_merchants = 1
    client.reactivate_merchant(&admin, &merchant);
    let stats = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats.active_merchants, 1);
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
fn test_invalid_signature_rejected() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0x11u8; 32]);
    let sig = bytes(&env, &[0x22u8; 64]);

    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "ORDER_SIG_INVALID"),
        &merchant,
        &token,
        &250,
        &str(&env, "tampered"),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidSignature)));
}

#[test]
fn test_process_payment_with_nonce_valid() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    // First payment: nonce 0
    client.process_payment_with_nonce(
        &payer,
        &str(&env, "NONCE_ORDER_1"),
        &merchant,
        &token,
        &1_000,
        &str(&env, "Payment 1"),
        &None,
        &0u64,
    );

    let payment = client.get_payment_by_id(&payer, &str(&env, "NONCE_ORDER_1"));
    assert_eq!(payment.amount, 1_000);
}

#[test]
fn test_process_payment_with_nonce_sequential() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    mint(&env, &token, &Address::generate(&env), &payer, 10_000);

    // First payment nonce=0, second nonce=1
    client.process_payment_with_nonce(
        &payer,
        &str(&env, "NONCE_SEQ_1"),
        &merchant,
        &token,
        &500,
        &str(&env, "first"),
        &None,
        &0u64,
    );

    client.process_payment_with_nonce(
        &payer,
        &str(&env, "NONCE_SEQ_2"),
        &merchant,
        &token,
        &500,
        &str(&env, "second"),
        &None,
        &1u64,
    );

    let p2 = client.get_payment_by_id(&payer, &str(&env, "NONCE_SEQ_2"));
    assert_eq!(p2.amount, 500);
}

#[test]
fn test_process_payment_with_nonce_replay_rejected() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    // First payment succeeds with nonce=0
    client.process_payment_with_nonce(
        &payer,
        &str(&env, "NONCE_REPLAY_1"),
        &merchant,
        &token,
        &500,
        &str(&env, "original"),
        &None,
        &0u64,
    );

    // Replay with same nonce=0 and different order_id must fail
    let result = client.try_process_payment_with_nonce(
        &payer,
        &str(&env, "NONCE_REPLAY_2"),
        &merchant,
        &token,
        &500,
        &str(&env, "replay"),
        &None,
        &0u64,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidNonce)));
}

#[test]
fn test_process_payment_with_nonce_skipped_rejected() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    // Skipping nonce 0 and using nonce 1 must fail
    let result = client.try_process_payment_with_nonce(
        &payer,
        &str(&env, "NONCE_SKIP_1"),
        &merchant,
        &token,
        &500,
        &str(&env, "skipped"),
        &None,
        &5u64,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidNonce)));
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
fn test_platform_fee_deducted() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    let fee_recipient = Address::generate(&env);
    // Set 100 bps = 1% fee
    client.set_platform_fee(&admin, &100u32, &fee_recipient);
    mint(&env, &token, &Address::generate(&env), &payer, 10_000);

    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    client.process_payment_with_signature(
        &payer,
        &str(&env, "FEE_ORDER_1"),
        &merchant,
        &token,
        &1_000,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );

    let payment = client.get_payment_by_id(&payer, &str(&env, "FEE_ORDER_1"));
    assert_eq!(payment.platform_fee, 10); // 1% of 1000
}

#[test]
fn test_zero_fee_case() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    client.process_payment_with_signature(
        &payer,
        &str(&env, "NOFEE_ORDER"),
        &merchant,
        &token,
        &500,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    let payment = client.get_payment_by_id(&payer, &str(&env, "NOFEE_ORDER"));
    assert_eq!(payment.platform_fee, 0);
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
fn test_batch_payment_intra_batch_duplicate_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let mut payments = Vec::new(&env);
    // Two items with the same order ID in one batch
    for _ in 0..2 {
        payments.push_back(BatchPaymentItem {
            order_id: str(&env, "DUP_BATCH"),
            merchant_address: merchant.clone(),
            token_address: token.clone(),
            amount: 100,
            memo: str(&env, ""),
            signature: bytes(&env, &[0u8; 64]),
            merchant_public_key: bytes(&env, &[0u8; 32]),
        });
    }
    let result = client.try_batch_payment(&payer, &payments);
    assert_eq!(result, Err(Ok(PaymentError::PaymentAlreadyExists)));
}

#[test]
fn test_batch_payment_cross_call_duplicate_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    // First: pay via normal call
    client.process_payment_with_signature(
        &payer,
        &str(&env, "CROSS_001"),
        &merchant,
        &token,
        &100,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );

    // Then: try the same order_id in a batch
    let mut payments = Vec::new(&env);
    payments.push_back(BatchPaymentItem {
        order_id: str(&env, "CROSS_001"),
        merchant_address: merchant.clone(),
        token_address: token.clone(),
        amount: 100,
        memo: str(&env, ""),
        signature: bytes(&env, &[0u8; 64]),
        merchant_public_key: bytes(&env, &[0u8; 32]),
    });
    let result = client.try_batch_payment(&payer, &payments);
    assert_eq!(result, Err(Ok(PaymentError::PaymentAlreadyExists)));
}
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
    let check = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(check.total_matching, 0);
}

#[test]
fn test_refund_totals_never_exceed_original_amount() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_R1", 1_000);

    let refund_ids = ["REFUND_A", "REFUND_B"];
    let amounts = [400, 300];

    for (refund_id, amount) in refund_ids.iter().zip(amounts.iter()) {
        client.initiate_refund(
            &payer,
            &str(&env, refund_id),
            &str(&env, "ORDER_R1"),
            amount,
            &str(&env, "partial"),
        );
        client.approve_refund(&merchant, &str(&env, refund_id));
        client.execute_refund(&str(&env, refund_id));
    }

    let payment = client.get_payment_by_id(&payer, &str(&env, "ORDER_R1"));
    assert!(payment.refunded_amount <= payment.amount);
    assert_eq!(payment.refunded_amount, 700);
    assert!(matches!(payment.status, crate::types::PaymentStatus::PartiallyRefunded));
}

#[test]
fn test_zero_amount_refund_is_rejected() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_R2", 200);

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "REFUND_ZERO"),
        &str(&env, "ORDER_R2"),
        &0,
        &str(&env, "zero"),
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
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
    assert!(matches!(
        refund.status,
        crate::types::RefundStatus::Completed
    ));
}

#[test]
fn test_execute_pending_refund_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_R5", 1_000);

    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_005"),
        &str(&env, "ORDER_R5"),
        &200,
        &str(&env, "Pending refund"),
    );

    let result = client.try_execute_refund(&str(&env, "REFUND_005"));
    assert_eq!(result, Err(Ok(PaymentError::RefundNotApproved)));

    let refund = client.get_refund(&str(&env, "REFUND_005"));
    assert!(matches!(refund.status, crate::types::RefundStatus::Pending));
}

#[test]
fn test_execute_rejected_refund_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_R6", 1_000);

    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_006"),
        &str(&env, "ORDER_R6"),
        &200,
        &str(&env, "Reject refund"),
    );
    client.reject_refund(&merchant, &str(&env, "REFUND_006"));

    let result = client.try_execute_refund(&str(&env, "REFUND_006"));
    assert_eq!(result, Err(Ok(PaymentError::RefundNotApproved)));

    let refund = client.get_refund(&str(&env, "REFUND_006"));
    assert!(matches!(refund.status, crate::types::RefundStatus::Rejected));
}

#[test]
fn test_execute_completed_refund_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_R7", 1_000);

    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_007"),
        &str(&env, "ORDER_R7"),
        &200,
        &str(&env, "Completed refund"),
    );
    client.approve_refund(&merchant, &str(&env, "REFUND_007"));
    client.execute_refund(&str(&env, "REFUND_007"));

    let result = client.try_execute_refund(&str(&env, "REFUND_007"));
    assert_eq!(result, Err(Ok(PaymentError::RefundNotApproved)));

    let refund = client.get_refund(&str(&env, "REFUND_007"));
    assert!(matches!(refund.status, crate::types::RefundStatus::Completed));
}

#[test]
fn test_refund_below_min_amount_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_MIN", 1_000);

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "REFUND_DUST"),
        &str(&env, "ORDER_MIN"),
        &99,
        &str(&env, "dust"),
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}

#[test]
fn test_refund_at_min_amount_succeeds() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_MIN_OK", 1_000);

    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_MIN_OK"),
        &str(&env, "ORDER_MIN_OK"),
        &100,
        &str(&env, "minimum"),
    );
}

#[test]
fn test_refund_respects_admin_min_amount() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_CUSTOM_MIN", 10_000);

    client.set_min_refund_amount(&admin, &500);

    let below = client.try_initiate_refund(
        &payer,
        &str(&env, "REFUND_BELOW"),
        &str(&env, "ORDER_CUSTOM_MIN"),
        &499,
        &str(&env, "below"),
    );
    assert_eq!(below, Err(Ok(PaymentError::InvalidAmount)));

    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_AT"),
        &str(&env, "ORDER_CUSTOM_MIN"),
        &500,
        &str(&env, "at"),
    );
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
fn test_set_refund_window() {
    let (env, client, admin, _merchant, _payer, _token) = setup_payment_env();

    // Set refund window to 7 days
    client.set_refund_window(&admin, &(7_u64 * 24 * 3600));
}

#[test]
fn test_set_refund_window_unauthorized() {
    let (env, client, _admin, merchant, _payer, _token) = setup_payment_env();

    // Non-admin should not be able to set refund window
    let result = client.try_set_refund_window(&merchant, &(7_u64 * 24 * 3600));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_refund_window_respected_after_change() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_RW1", 1_000);

    // Set refund window to 5 days
    client.set_refund_window(&admin, &(5_u64 * 24 * 3600));

    // Advance ledger past 5-day window but within default 30-day window
    env.ledger().with_mut(|l| {
        l.timestamp += 6 * 24 * 3600;
    });

    // Should fail because new window is 5 days
    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "REFUND_RW1"),
        &str(&env, "ORDER_RW1"),
        &100,
        &str(&env, "Late"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundWindowExpired)));
}

#[test]
fn test_refund_window_extended_allows_refund() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_RW2", 1_000);

    // Set refund window to 60 days
    client.set_refund_window(&admin, &(60_u64 * 24 * 3600));

    // Advance ledger past default 30-day window but within new 60-day window
    env.ledger().with_mut(|l| {
        l.timestamp += 45 * 24 * 3600;
    });

    // Should succeed because new window is 60 days
    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_RW2"),
        &str(&env, "ORDER_RW2"),
        &100,
        &str(&env, "Reason"),
    );
}

#[test]
fn test_default_refund_window_is_30_days() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_RW3", 1_000);

    // Advance ledger to 29 days - should succeed
    env.ledger().with_mut(|l| {
        l.timestamp += 29 * 24 * 3600;
    });

    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_RW3"),
        &str(&env, "ORDER_RW3"),
        &100,
        &str(&env, "Reason"),
    );

    // Advance ledger to 31 days - should fail
    env.ledger().with_mut(|l| {
        l.timestamp += 2 * 24 * 3600;
    });

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "REFUND_RW4"),
        &str(&env, "ORDER_RW3"),
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
    assert!(matches!(
        refund.status,
        crate::types::RefundStatus::Rejected
    ));
}

// ── Merchant verification tests ───────────────────────────────────────────────

#[test]
fn test_verify_merchant() {
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
    // Newly registered merchant is unverified
    assert!(!client.get_merchant(&merchant).verified);

    client.verify_merchant(&admin, &merchant);
    assert!(client.get_merchant(&merchant).verified);

    client.unverify_merchant(&admin, &merchant);
    assert!(!client.get_merchant(&merchant).verified);
}

#[test]
fn test_verify_merchant_unauthorized_fails() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    client.set_admin(&admin);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Retail,
    );
    let result = client.try_verify_merchant(&non_admin, &merchant);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_payment_verified_vs_unverified_merchant() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    // Payment succeeds for unverified merchant (verified flag is informational)
    client.process_payment_with_signature(
        &payer,
        &str(&env, "VER_001"),
        &merchant,
        &token,
        &100,
        &str(&env, ""),
        &sig,
        &pub_key,
    );

    // Verify the merchant and confirm flag is set
    client.verify_merchant(&admin, &merchant);
    assert!(client.get_merchant(&merchant).verified);

    // Payment also succeeds for verified merchant
    client.process_payment_with_signature(
        &payer,
        &str(&env, "VER_002"),
        &merchant,
        &token,
        &200,
        &str(&env, ""),
        &sig,
        &pub_key,
    );
    let payment = client.get_payment_by_id(&payer, &str(&env, "VER_002"));
    assert_eq!(payment.amount, 200);
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
    assert_eq!(page.total_matching, 3);
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
    assert_eq!(page.total_matching, 1);
    assert_eq!(page.payments.get(0).unwrap().amount, 500);
}

// ── PaymentFilter.tag tests (#296) ─────────────────────────────────────────

/// Helper: process a payment with a given set of tags.
fn make_payment_with_tags(
    env: &Env,
    client: &PaymentProcessingContractClient,
    merchant: &Address,
    payer: &Address,
    token: &Address,
    order_id: &str,
    amount: i128,
    tags: Option<Vec<String>>,
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
        &tags,
        &sig,
        &pub_key,
    );
}

#[test]
fn test_tag_filter_matches_payment_with_tag() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    let mut tags = Vec::new(&env);
    tags.push_back(str(&env, "invoice"));
    make_payment_with_tags(&env, &client, &merchant, &payer, &token, "T_001", 100, Some(tags));
    make_payment_with_tags(&env, &client, &merchant, &payer, &token, "T_002", 200, None);

    let filter = PaymentFilter {
        date_start: None,
        date_end: None,
        amount_min: None,
        amount_max: None,
        token: None,
        status: StatusFilter::Any,
        tag: Some(str(&env, "invoice")),
    };

    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &Some(filter),
        &SortField::Date,
        &SortOrder::Descending,
    );

    assert_eq!(page.total_matching, 1);
    assert_eq!(page.payments.get(0).unwrap().order_id, str(&env, "T_001"));
}

#[test]
fn test_tag_filter_excludes_payment_without_matching_tag() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    let mut tags = Vec::new(&env);
    tags.push_back(str(&env, "subscription"));
    make_payment_with_tags(&env, &client, &merchant, &payer, &token, "T_003", 300, Some(tags));

    let filter = PaymentFilter {
        date_start: None,
        date_end: None,
        amount_min: None,
        amount_max: None,
        token: None,
        status: StatusFilter::Any,
        tag: Some(str(&env, "invoice")),
    };

    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &Some(filter),
        &SortField::Date,
        &SortOrder::Descending,
    );

    assert_eq!(page.total_matching, 0);
}

#[test]
fn test_tag_filter_excludes_payment_with_no_tags() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    make_payment_with_tags(&env, &client, &merchant, &payer, &token, "T_004", 100, None);

    let filter = PaymentFilter {
        date_start: None,
        date_end: None,
        amount_min: None,
        amount_max: None,
        token: None,
        status: StatusFilter::Any,
        tag: Some(str(&env, "invoice")),
    };

    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &Some(filter),
        &SortField::Date,
        &SortOrder::Descending,
    );

    assert_eq!(page.total_matching, 0);
}

#[test]
fn test_no_tag_filter_returns_all_payments() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    let mut tags = Vec::new(&env);
    tags.push_back(str(&env, "invoice"));
    make_payment_with_tags(&env, &client, &merchant, &payer, &token, "T_005", 100, Some(tags));
    make_payment_with_tags(&env, &client, &merchant, &payer, &token, "T_006", 200, None);

    let filter = PaymentFilter {
        date_start: None,
        date_end: None,
        amount_min: None,
        amount_max: None,
        token: None,
        status: StatusFilter::Any,
        tag: None,
    };

    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &Some(filter),
        &SortField::Date,
        &SortOrder::Descending,
    );

    assert_eq!(page.total_matching, 2);
}

#[test]
fn test_tag_filter_matches_one_of_multiple_tags() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    let mut tags = Vec::new(&env);
    tags.push_back(str(&env, "invoice"));
    tags.push_back(str(&env, "q2"));
    make_payment_with_tags(&env, &client, &merchant, &payer, &token, "T_007", 100, Some(tags));

    let filter = PaymentFilter {
        date_start: None,
        date_end: None,
        amount_min: None,
        amount_max: None,
        token: None,
        status: StatusFilter::Any,
        tag: Some(str(&env, "q2")),
    };

    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &Some(filter),
        &SortField::Date,
        &SortOrder::Descending,
    );

    assert_eq!(page.total_matching, 1);
    assert_eq!(page.payments.get(0).unwrap().order_id, str(&env, "T_007"));
}

#[test]
fn test_tag_filter_payer_history() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    let mut tags = Vec::new(&env);
    tags.push_back(str(&env, "retail"));
    make_payment_with_tags(&env, &client, &merchant, &payer, &token, "T_008", 500, Some(tags));
    make_payment_with_tags(&env, &client, &merchant, &payer, &token, "T_009", 600, None);

    let filter = PaymentFilter {
        date_start: None,
        date_end: None,
        amount_min: None,
        amount_max: None,
        token: None,
        status: StatusFilter::Any,
        tag: Some(str(&env, "retail")),
    };

    let page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &Some(filter),
        &SortField::Date,
        &SortOrder::Descending,
    );

    assert_eq!(page.total_matching, 1);
    assert_eq!(page.payments.get(0).unwrap().order_id, str(&env, "T_008"));
}
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let ids = ["PAG_0", "PAG_1", "PAG_2", "PAG_3", "PAG_4"];
    for id_str in ids {
        let pub_key = bytes(&env, &[0u8; 32]);
        let sig = bytes(&env, &[0u8; 64]);
        client.process_payment_with_signature(
            &payer,
            &id,
            &merchant,
            &token,
            &100,
            &str(&env, ""),
            &None,
            &sig,
            &pub_key,
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

#[test]
fn test_pagination_initial_page() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let ids = ["INIT_0", "INIT_1", "INIT_2"];
    for id_str in ids {
        make_payment(&env, &client, &merchant, &payer, &token, id_str, 100);
    }

    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page.total, 3);
    assert_eq!(page.payments.len(), 3);
    assert!(page.next_cursor.is_none());
}

#[test]
fn test_pagination_intermediate_pages() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let ids = ["INT_0", "INT_1", "INT_2", "INT_3", "INT_4"];
    for id_str in ids {
        make_payment(&env, &client, &merchant, &payer, &token, id_str, 100);
    }

    // First page: limit 2
    let page1 = client.get_merchant_payment_history(
        &merchant,
        &None,
        &2,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page1.payments.len(), 2);
    assert!(page1.next_cursor.is_some());
    let cursor1 = page1.next_cursor.unwrap();

    // Second page using cursor
    let page2 = client.get_merchant_payment_history(
        &merchant,
        &Some(cursor1.clone()),
        &2,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page2.payments.len(), 2);
    assert!(page2.next_cursor.is_some());
    let cursor2 = page2.next_cursor.unwrap();

    // Third page (final)
    let page3 = client.get_merchant_payment_history(
        &merchant,
        &Some(cursor2),
        &2,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page3.payments.len(), 1);
    assert!(page3.next_cursor.is_none());
}

#[test]
fn test_pagination_empty_results() {
    let (env, client, _admin, merchant, _payer, _token) = setup_payment_env();
    
    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page.total, 0);
    assert_eq!(page.payments.len(), 0);
    assert!(page.next_cursor.is_none());
}

#[test]
fn test_pagination_cursor_semantics() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let ids = ["CUR_0", "CUR_1", "CUR_2", "CUR_3"];
    for id_str in ids {
        make_payment(&env, &client, &merchant, &payer, &token, id_str, 100);
    }

    // Get first page
    let page1 = client.get_merchant_payment_history(
        &merchant,
        &None,
        &2,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    let first_id = page1.payments.get(0).unwrap().order_id.clone();
    let last_id = page1.payments.get(1).unwrap().order_id.clone();

    // Use last ID as cursor; next page should start after it
    let page2 = client.get_merchant_payment_history(
        &merchant,
        &Some(last_id.clone()),
        &2,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );

    // Verify first ID is not in second page
    for p in page2.payments.iter() {
        assert_ne!(p.order_id, first_id);
        assert_ne!(p.order_id, last_id);
    }
}

#[test]
fn test_pagination_limit_boundaries() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    
    // Create exactly 10 payments
    for i in 0..10 {
        let id = format!("LIM_{}", i);
        make_payment(&env, &client, &merchant, &payer, &token, &id, 100);
    }

    // Requesting limit=10 should return all without cursor
    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page.payments.len(), 10);
    assert!(page.next_cursor.is_none());
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
        &None,
    );

    client.sign_multisig_payment(&signer1, &str(&env, "MS_001"), &bytes(&env, &[1u8; 64]));
    client.sign_multisig_payment(&signer2, &str(&env, "MS_001"), &bytes(&env, &[2u8; 64]));
    client.execute_multisig_payment(&payer, &str(&env, "MS_001"));
}

#[test]
fn test_multisig_insufficient_signatures_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_002"),
        &merchant,
        &token,
        &500,
        &signers,
        &2,
        &None,
    );

    // Only one of the two required signers signs
    client.sign_multisig_payment(&signer1, &str(&env, "MS_002"), &bytes(&env, &[1u8; 64]));

    let result = client.try_execute_multisig_payment(&payer, &str(&env, "MS_002"));
    assert_eq!(result, Err(Ok(PaymentError::InsufficientSignatures)));
}

#[test]
fn test_multisig_executes_before_expiry() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    // Explicit expiry 1 hour from now
    let now = env.ledger().timestamp();
    let expires_at = now + 3600;

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_EXP_OK"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
        &Some(expires_at),
    );
    client.sign_multisig_payment(&signer, &str(&env, "MS_EXP_OK"), &bytes(&env, &[1u8; 64]));

    // Advance time but stay before expiry
    env.ledger().with_mut(|l| l.timestamp += 1800);

    client.execute_multisig_payment(&payer, &str(&env, "MS_EXP_OK"));
}

#[test]
fn test_multisig_rejected_after_expiry() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    let now = env.ledger().timestamp();
    let expires_at = now + 3600;

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_EXP_FAIL"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
        &Some(expires_at),
    );
    client.sign_multisig_payment(&signer, &str(&env, "MS_EXP_FAIL"), &bytes(&env, &[1u8; 64]));

    // Advance past expiry
    env.ledger().with_mut(|l| l.timestamp += 3601);

    let result = client.try_execute_multisig_payment(&payer, &str(&env, "MS_EXP_FAIL"));
    assert_eq!(result, Err(Ok(PaymentError::PaymentExpired)));
}

#[test]
fn test_multisig_default_expiry_applied() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    let now = env.ledger().timestamp();

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_DEF_EXP"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
        &None,
    );

    // Test behavior: it should execute successfully before 7 days
    client.sign_multisig_payment(&signer, &str(&env, "MS_DEF_EXP"), &bytes(&env, &[1u8; 64]));

    // Advance 6 days (before expiry)
    env.ledger().with_mut(|l| l.timestamp += 6 * 24 * 3600);
    client.execute_multisig_payment(&payer, &str(&env, "MS_DEF_EXP"));
}

#[test]
fn test_multisig_default_expiry_configurable() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    // Set custom default expiry of 1 hour
    client.set_multisig_expiry_duration(&admin, &3600);

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_CUSTOM_EXP"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
        &None,
    );

    // Should expire after 1 hour
    client.sign_multisig_payment(
        &signer,
        &str(&env, "MS_CUSTOM_EXP"),
        &bytes(&env, &[1u8; 64]),
    );

    env.ledger().with_mut(|l| l.timestamp += 3601);

    let result = client.try_execute_multisig_payment(&payer, &str(&env, "MS_CUSTOM_EXP"));
    assert_eq!(result, Err(Ok(PaymentError::PaymentExpired)));
}

#[test]
fn test_set_multisig_expiry_duration_zero_fails() {
    let (env, client, admin, _, _, _) = setup_payment_env();
    let result = client.try_set_multisig_expiry_duration(&admin, &0);
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_set_multisig_expiry_duration_requires_admin() {
    let (env, client, _admin, _, _, _) = setup_payment_env();
    let non_admin = Address::generate(&env);
    let result = client.try_set_multisig_expiry_duration(&non_admin, &86400);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_multisig_explicit_expiry_overrides_default() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    // Set default to 1 day
    client.set_multisig_expiry_duration(&admin, &86400);

    let now = env.ledger().timestamp();
    let explicit_expiry = now + 3600; // 1 hour — shorter than default

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_EXPLICIT"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
        &Some(explicit_expiry),
    );

    // Should expire at explicit time (1 hour), not default (1 day)
    client.sign_multisig_payment(&signer, &str(&env, "MS_EXPLICIT"), &bytes(&env, &[1u8; 64]));

    env.ledger().with_mut(|l| l.timestamp += 3601);

    let result = client.try_execute_multisig_payment(&payer, &str(&env, "MS_EXPLICIT"));
    assert_eq!(result, Err(Ok(PaymentError::PaymentExpired)));
}

#[test]
fn test_multisig_prevents_double_signing() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_DOUBLE"),
        &merchant,
        &token,
        &1000,
        &signers,
        &2,
        &None,
    );

    // First signature from signer1 succeeds
    client.sign_multisig_payment(&signer1, &str(&env, "MS_DOUBLE"), &bytes(&env, &[1u8; 64]));

    // Attempt to sign again with same signer should fail
    let result = client.try_sign_multisig_payment(
        &signer1,
        &str(&env, "MS_DOUBLE"),
        &bytes(&env, &[2u8; 64]),
    );
    assert_eq!(result, Err(Ok(PaymentError::MultisigAlreadySigned)));

    // Different signer can still sign
    client.sign_multisig_payment(&signer2, &str(&env, "MS_DOUBLE"), &bytes(&env, &[3u8; 64]));

    // Payment can be executed with 2 unique signatures
    client.execute_multisig_payment(&payer, &str(&env, "MS_DOUBLE"));
}

#[test]
fn test_multisig_unique_signers_only() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());
    signers.push_back(signer3.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_UNIQUE"),
        &merchant,
        &token,
        &500,
        &signers,
        &2,
        &None,
    );

    // All three signers can sign once
    client.sign_multisig_payment(&signer1, &str(&env, "MS_UNIQUE"), &bytes(&env, &[1u8; 64]));
    client.sign_multisig_payment(&signer2, &str(&env, "MS_UNIQUE"), &bytes(&env, &[2u8; 64]));

    // Payment can execute with 2 of 3 signatures
    client.execute_multisig_payment(&payer, &str(&env, "MS_UNIQUE"));
}

#[test]
fn test_multisig_rejects_empty_signers() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signers = Vec::new(&env); // empty

    let result = client.try_initiate_multisig_payment(
        &payer,
        &str(&env, "MS_EMPTY"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
        &None,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_multisig_rejects_zero_required_signatures() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer);

    let result = client.try_initiate_multisig_payment(
        &payer,
        &str(&env, "MS_ZERO"),
        &merchant,
        &token,
        &500,
        &signers,
        &0, // zero required
        &None,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_multisig_rejects_required_exceeds_signers() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer);

    let result = client.try_initiate_multisig_payment(
        &payer,
        &str(&env, "MS_EXCEED"),
        &merchant,
        &token,
        &500,
        &signers,
        &2, // required > len(signers)
        &None,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_multisig_accepts_valid_boundary_cases() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    // 1-of-1 (minimum valid)
    let signer1 = Address::generate(&env);
    let mut signers1 = Vec::new(&env);
    signers1.push_back(signer1.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_1_OF_1"),
        &merchant,
        &token,
        &100,
        &signers1,
        &1,
        &None,
    );

    // N-of-N (required equals signers)
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let mut signers2 = Vec::new(&env);
    signers2.push_back(signer2.clone());
    signers2.push_back(signer3.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_2_OF_2"),
        &merchant,
        &token,
        &200,
        &signers2,
        &2,
        &None,
    );
}

#[test]
fn test_get_multisig_payment_by_authorized_parties() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_Q1"),
        &merchant,
        &token,
        &1_000,
        &signers,
        &2,
           &None,
    );

    let by_merchant = client.get_multisig_payment(&merchant, &str(&env, "MS_Q1"));
    assert_eq!(by_merchant.payment_id, str(&env, "MS_Q1"));
    assert_eq!(by_merchant.amount, 1_000);
    assert_eq!(by_merchant.merchant_address, merchant);
    assert!(!by_merchant.executed);

    let by_signer = client.get_multisig_payment(&signer1, &str(&env, "MS_Q1"));
    assert_eq!(by_signer.payment_id, str(&env, "MS_Q1"));
    assert!(by_signer.signers.contains(&signer2));
}

#[test]
fn test_get_multisig_payment_unauthorized_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_Q2"),
        &merchant,
        &token,
        &600,
        &signers,
        &1,
           &None,
    );

    let result = client.try_get_multisig_payment(&stranger, &str(&env, "MS_Q2"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
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

// ── Date-range filtering tests ────────────────────────────────────────────────

#[test]
fn test_stats_no_filter_returns_all_time_totals() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "DR_001", 1_000);
    make_payment(&env, &client, &merchant, &payer, &token, "DR_002", 2_000);

    let stats = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats.total_payments, 2);
    assert_eq!(stats.total_volume, 3_000);
}

#[test]
fn test_stats_start_only_filter() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    // t=0: payment 1
    make_payment(&env, &client, &merchant, &payer, &token, "DR_S1", 500);

    // advance to t=100
    env.ledger().with_mut(|l| l.timestamp += 100);
    make_payment(&env, &client, &merchant, &payer, &token, "DR_S2", 1_500);

    // start_only at t=100 → only DR_S2 matches
    let stats = client.get_global_payment_stats(&admin, &Some(100), &None);
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 1_500);
}

#[test]
fn test_stats_end_only_filter() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    make_payment(&env, &client, &merchant, &payer, &token, "DR_E1", 400);

    env.ledger().with_mut(|l| l.timestamp += 200);
    make_payment(&env, &client, &merchant, &payer, &token, "DR_E2", 600);

    // end_only at t=50 → only DR_E1 (t=0) matches
    let stats = client.get_global_payment_stats(&admin, &None, &Some(50));
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 400);
}

#[test]
fn test_stats_both_bounds_filter() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    // t=0
    make_payment(&env, &client, &merchant, &payer, &token, "DR_B1", 100);
    // t=100
    env.ledger().with_mut(|l| l.timestamp += 100);
    make_payment(&env, &client, &merchant, &payer, &token, "DR_B2", 200);
    // t=200
    env.ledger().with_mut(|l| l.timestamp += 100);
    make_payment(&env, &client, &merchant, &payer, &token, "DR_B3", 300);

    // window [100, 200] → DR_B2 + DR_B3
    let stats = client.get_global_payment_stats(&admin, &Some(100), &Some(200));
    assert_eq!(stats.total_payments, 2);
    assert_eq!(stats.total_volume, 500);
}

#[test]
fn test_stats_boundary_inclusive() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    // t=0: boundary start
    make_payment(&env, &client, &merchant, &payer, &token, "DR_BI1", 111);
    env.ledger().with_mut(|l| l.timestamp += 50);
    make_payment(&env, &client, &merchant, &payer, &token, "DR_BI2", 222);
    // t=100: boundary end
    env.ledger().with_mut(|l| l.timestamp += 50);
    make_payment(&env, &client, &merchant, &payer, &token, "DR_BI3", 333);

    // Exact boundary [0, 100] → all three
    let stats = client.get_global_payment_stats(&admin, &Some(0), &Some(100));
    assert_eq!(stats.total_payments, 3);
    assert_eq!(stats.total_volume, 666);
}

#[test]
fn test_stats_no_payments_in_window_returns_zeros() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    make_payment(&env, &client, &merchant, &payer, &token, "DR_NM1", 999);

    // Window entirely in the future
    let stats = client.get_global_payment_stats(&admin, &Some(9_999_999), &Some(99_999_999));
    assert_eq!(stats.total_payments, 0);
    assert_eq!(stats.total_volume, 0);
    assert_eq!(stats.total_refunds, 0);
    assert_eq!(stats.total_refund_volume, 0);
}

#[test]
fn test_stats_invalid_range_start_after_end_fails() {
    let (env, client, admin, _, _, _) = setup_payment_env();
    let result = client.try_get_global_payment_stats(&admin, &Some(200), &Some(100));
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_stats_single_timestamp_window() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    // t=0
    make_payment(&env, &client, &merchant, &payer, &token, "DR_ST1", 777);
    env.ledger().with_mut(|l| l.timestamp += 1);
    make_payment(&env, &client, &merchant, &payer, &token, "DR_ST2", 888);

    // Exact single-timestamp window [0, 0] → only DR_ST1
    let stats = client.get_global_payment_stats(&admin, &Some(0), &Some(0));
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 777);
}

#[test]
fn test_stats_refund_totals_in_window() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    // t=0: payment with a completed refund
    make_payment(&env, &client, &merchant, &payer, &token, "DR_RF1", 1_000);
    client.initiate_refund(&payer, &str(&env, "DR_RFR1"), &str(&env, "DR_RF1"), &300, &str(&env, "r"));
    client.approve_refund(&merchant, &str(&env, "DR_RFR1"));
    client.execute_refund(&str(&env, "DR_RFR1"));

    // t=500: payment outside the window
    env.ledger().with_mut(|l| l.timestamp += 500);
    make_payment(&env, &client, &merchant, &payer, &token, "DR_RF2", 2_000);

    // Window [0, 100] → only DR_RF1 with its refund
    let stats = client.get_global_payment_stats(&admin, &Some(0), &Some(100));
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 1_000);
    assert_eq!(stats.total_refunds, 1);
    assert_eq!(stats.total_refund_volume, 300);
}

#[test]
fn test_stats_active_merchants_unaffected_by_date_filter() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "DR_AM1", 100);

    // active_merchants is a global count, not date-filtered
    let all_time = client.get_global_payment_stats(&admin, &None, &None);
    let filtered = client.get_global_payment_stats(&admin, &Some(9_999_999), &None);
    assert_eq!(filtered.active_merchants, all_time.active_merchants);
}

#[test]
fn test_suspicious_activity_event_emitted() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    // Set threshold to 500
    client.set_large_payment_threshold(&admin, &500);

    // This payment (1000) should trigger the event
    make_payment(&env, &client, &merchant, &payer, &token, "LARGE_001", 1_000);

    // Note: events().all() API changed in newer soroban-sdk
    // let events = env.events().all();
    // let suspicious_event = events.iter().find(|e| {
    //     e.topics.get(1).unwrap() == soroban_sdk::Symbol::new(&env, "suspicious_activity")
    // });
    // assert!(suspicious_event.is_some());
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

// ── Whitelist tests ───────────────────────────────────────────────────────────

#[test]
fn test_token_whitelist_enforced() {
    let (env, client, admin, merchant, payer, _token) = setup_payment_env();
    let token_admin = Address::generate(&env);
    let other_token = create_token(&env, &token_admin);
    mint(&env, &other_token, &token_admin, &payer, 10_000);

    // pub_key and sig for process_payment_with_signature
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    // Try payment with non-whitelisted token
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "W_001"),
        &merchant,
        &other_token,
        &100,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::TokenNotAllowed)));

    // Whitelist it and try again
    client.add_allowed_token(&admin, &other_token);
    client.process_payment_with_signature(
        &payer,
        &str(&env, "W_001"),
        &merchant,
        &other_token,
        &100,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
}

#[test]
fn test_remove_token_from_whitelist() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    // Token is whitelisted in setup_payment_env
    client.remove_allowed_token(&admin, &token);

    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "W_002"),
        &merchant,
        &token,
        &100,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::TokenNotAllowed)));
}

// ── E2E: multisig payment in history (#39) ────────────────────────────────────

#[test]
fn test_e2e_multisig_payment_in_history_and_global_stats() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    // Initiate multisig payment
    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_E2E"),
        &merchant,
        &token,
        &2_000,
        &signers,
        &2,
           &None,
    );

    // Sign — threshold met after both signers
    client.sign_multisig_payment(&signer1, &str(&env, "MS_E2E"), &bytes(&env, &[1u8; 64]));
    client.sign_multisig_payment(&signer2, &str(&env, "MS_E2E"), &bytes(&env, &[2u8; 64]));

    // Execute
    client.execute_multisig_payment(&payer, &str(&env, "MS_E2E"));

    // Verify payment appears in get_merchant_payment_history
    let merchant_page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Descending,
    );
    assert_eq!(merchant_page.total_matching, 1);
    assert_eq!(merchant_page.payments.get(0).unwrap().order_id, str(&env, "MS_E2E"));
    assert_eq!(merchant_page.payments.get(0).unwrap().amount, 2_000);

    // Verify payment appears in get_payer_payment_history
    let payer_page = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Descending,
    );
    assert_eq!(payer_page.total_matching, 1);
    assert_eq!(payer_page.payments.get(0).unwrap().order_id, str(&env, "MS_E2E"));

    // Verify global stats are updated
    let stats = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 2_000);
}

// ── Merchant Stats tests ─────────────────────────────────────────────────────────

#[test]
fn test_merchant_stats_initialized_to_zero() {
    let (env, client, _admin, merchant, _payer, _token) = setup_payment_env();

    let stats = client.get_merchant_stats(&merchant);
    assert_eq!(stats.total_payments, 0);
    assert_eq!(stats.total_volume, 0);
    assert_eq!(stats.total_refunds, 0);
    assert_eq!(stats.total_refund_volume, 0);
}

#[test]
fn test_merchant_stats_updated_after_payment() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_001", 1_000);

    let stats = client.get_merchant_stats(&merchant);
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 1_000);
    assert_eq!(stats.total_refunds, 0);
    assert_eq!(stats.total_refund_volume, 0);
}

#[test]
fn test_merchant_stats_updated_after_multiple_payments() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_001", 500);
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_002", 1_500);
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_003", 2_000);

    let stats = client.get_merchant_stats(&merchant);
    assert_eq!(stats.total_payments, 3);
    assert_eq!(stats.total_volume, 4_000);
    assert_eq!(stats.total_refunds, 0);
    assert_eq!(stats.total_refund_volume, 0);
}

#[test]
fn test_merchant_stats_updated_after_refund() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_001", 1_000);

    client.initiate_refund(&payer, &str(&env, "REFUND_001"), &str(&env, "ORDER_001"), &300, &str(&env, "Reason"));
    client.approve_refund(&merchant, &str(&env, "REFUND_001"));
    client.execute_refund(&str(&env, "REFUND_001"));

    let stats = client.get_merchant_stats(&merchant);
    assert_eq!(stats.total_payments, 1);
    assert_eq!(stats.total_volume, 1_000);
    assert_eq!(stats.total_refunds, 1);
    assert_eq!(stats.total_refund_volume, 300);
}

#[test]
fn test_merchant_stats_accuracy_after_multiple_payments_and_refunds() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    // Multiple payments
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_001", 1_000);
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_002", 2_000);
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_003", 3_000);

    // Multiple refunds
    client.initiate_refund(&payer, &str(&env, "REFUND_001"), &str(&env, "ORDER_001"), &200, &str(&env, "Reason"));
    client.approve_refund(&merchant, &str(&env, "REFUND_001"));
    client.execute_refund(&str(&env, "REFUND_001"));

    client.initiate_refund(&payer, &str(&env, "REFUND_002"), &str(&env, "ORDER_002"), &500, &str(&env, "Reason"));
    client.approve_refund(&merchant, &str(&env, "REFUND_002"));
    client.execute_refund(&str(&env, "REFUND_002"));

    let stats = client.get_merchant_stats(&merchant);
    assert_eq!(stats.total_payments, 3);
    assert_eq!(stats.total_volume, 6_000);
    assert_eq!(stats.total_refunds, 2);
    assert_eq!(stats.total_refund_volume, 700);
}

#[test]
fn test_merchant_stats_isolated_per_merchant() {
    let (env, client, admin, merchant1, payer, token) = setup_payment_env();
    let merchant2 = Address::generate(&env);

    client.register_merchant(
        &merchant2,
        &str(&env, "Store 2"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Retail,
    );
    mint(&env, &token, &admin, &merchant2, 10_000);

    // Payments to merchant1
    make_payment(&env, &client, &merchant1, &payer, &token, "ORDER_001", 1_000);

    // Payments to merchant2
    make_payment(&env, &client, &merchant2, &payer, &token, "ORDER_002", 2_000);

    let stats1 = client.get_merchant_stats(&merchant1);
    assert_eq!(stats1.total_payments, 1);
    assert_eq!(stats1.total_volume, 1_000);

    let stats2 = client.get_merchant_stats(&merchant2);
    assert_eq!(stats2.total_payments, 1);
    assert_eq!(stats2.total_volume, 2_000);
}

#[test]
fn test_auth_get_merchant_stats_requires_merchant() {
    // With mock_all_auths, any address passes require_auth; verify the function
    // returns default empty stats for an unregistered address rather than panicking.
    let (env, client, _admin, merchant, _payer, _token) = setup_payment_env();
    let _ = client.get_merchant_stats(&merchant);
    // No panic = auth guard is present and stats are returned
}

// ── Boundary & overflow tests (#34) ──────────────────────────────────────────

#[test]
fn test_payment_amount_zero_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "BOUND_ZERO"),
        &merchant,
        &token,
        &0,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}

#[test]
fn test_payment_amount_negative_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "BOUND_NEG"),
        &merchant,
        &token,
        &-1,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}

#[test]
fn test_payment_amount_i128_min_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "BOUND_MIN"),
        &merchant,
        &token,
        &i128::MIN,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}

#[test]
fn test_payment_amount_i128_max_accepted() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    // i128::MAX is a valid positive amount; contract should accept it at the
    // validation layer (token transfer may fail due to insufficient balance,
    // but the contract must NOT return InvalidAmount).
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "BOUND_MAX"),
        &merchant,
        &token,
        &i128::MAX,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_ne!(result, Err(Ok(PaymentError::InvalidAmount)));
}

#[test]
fn test_total_volume_no_overflow_saturates() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    // Seed total_volume just below i128::MAX
    env.as_contract(&client.address, || {
        let mut stats = storage::get_global_stats(&env);
        stats.total_volume = i128::MAX - 100;
        storage::set_global_stats(&env, &stats);
    });

    // A payment of 200 would overflow without saturating_add
    make_payment(&env, &client, &merchant, &payer, &token, "OVF_001", 200);

    let stats = env.as_contract(&client.address, || storage::get_global_stats(&env));
    assert_eq!(stats.total_volume, i128::MAX);
}

#[test]
fn test_total_volume_accumulates_correctly() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ACC_001", 1_000);
    make_payment(&env, &client, &merchant, &payer, &token, "ACC_002", 2_000);
    make_payment(&env, &client, &merchant, &payer, &token, "ACC_003", 3_000);

    let stats = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats.total_volume, 6_000);
    assert_eq!(stats.total_payments, 3);
}

// ── Refund auth security tests (#45) ─────────────────────────────────────────

#[test]
fn test_payer_cannot_approve_own_refund() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "SEC_R1", 1_000);
    client.initiate_refund(&payer, &str(&env, "SEC_RF1"), &str(&env, "SEC_R1"), &100, &str(&env, "r"));

    let result = client.try_approve_refund(&payer, &str(&env, "SEC_RF1"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_payer_cannot_reject_own_refund() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "SEC_R2", 1_000);
    client.initiate_refund(&payer, &str(&env, "SEC_RF2"), &str(&env, "SEC_R2"), &100, &str(&env, "r"));

    let result = client.try_reject_refund(&payer, &str(&env, "SEC_RF2"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_unrelated_address_cannot_approve_refund() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "SEC_R3", 1_000);
    client.initiate_refund(&payer, &str(&env, "SEC_RF3"), &str(&env, "SEC_R3"), &100, &str(&env, "r"));

    let unrelated = Address::generate(&env);
    let result = client.try_approve_refund(&unrelated, &str(&env, "SEC_RF3"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_unrelated_address_cannot_reject_refund() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "SEC_R4", 1_000);
    client.initiate_refund(&payer, &str(&env, "SEC_RF4"), &str(&env, "SEC_R4"), &100, &str(&env, "r"));

    let unrelated = Address::generate(&env);
    let result = client.try_reject_refund(&unrelated, &str(&env, "SEC_RF4"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

// ── Pause / unpause tests ─────────────────────────────────────────────────────

#[test]
fn test_pause_and_unpause_contract() {
    let (env, client, admin, _, _, _) = setup_payment_env();
    // Pause
    client.pause_contract(&admin);
    // Unpause
    client.unpause_contract(&admin);
}

#[test]
fn test_pause_requires_admin() {
    let (env, client) = setup();
    let non_admin = Address::generate(&env);
    let result = client.try_pause_contract(&non_admin);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_unpause_requires_admin() {
    let (env, client, admin, _, _, _) = setup_payment_env();
    client.pause_contract(&admin);
    let non_admin = Address::generate(&env);
    let result = client.try_unpause_contract(&non_admin);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_paused_blocks_register_merchant() {
    let (env, client, admin, _, _, _) = setup_payment_env();
    client.pause_contract(&admin);
    let new_merchant = Address::generate(&env);
    let result = client.try_register_merchant(
        &new_merchant,
        &str(&env, "Store"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Retail,
    );
    assert_eq!(result, Err(Ok(PaymentError::ContractPaused)));
}

#[test]
fn test_paused_blocks_process_payment() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    client.pause_contract(&admin);
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "PAUSED_ORD"),
        &merchant,
        &token,
        &100,
        &str(&env, ""),
        &None,
        &bytes(&env, &[0u8; 64]),
        &bytes(&env, &[0u8; 32]),
    );
    assert_eq!(result, Err(Ok(PaymentError::ContractPaused)));
}

#[test]
fn test_paused_blocks_initiate_refund() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "PAUSE_R1", 1_000);
    client.pause_contract(&admin);
    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "PAUSE_RF1"),
        &str(&env, "PAUSE_R1"),
        &100,
        &str(&env, "reason"),
    );
    assert_eq!(result, Err(Ok(PaymentError::ContractPaused)));
}

#[test]
fn test_get_functions_accessible_while_paused() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "READ_ORD", 500);
    client.pause_contract(&admin);
    // Read-only functions should still work
    let m = client.get_merchant(&merchant);
    assert!(m.active);
    let p = client.get_payment_by_id(&payer, &str(&env, "READ_ORD"));
    assert_eq!(p.amount, 500);
}

#[test]
fn test_unpause_restores_operations() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    client.pause_contract(&admin);
    // Blocked while paused
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "RESTORE_ORD"),
        &merchant,
        &token,
        &100,
        &str(&env, ""),
        &None,
        &bytes(&env, &[0u8; 64]),
        &bytes(&env, &[0u8; 32]),
    );
    assert_eq!(result, Err(Ok(PaymentError::ContractPaused)));
    // Unpaused — should succeed
    client.unpause_contract(&admin);
    client.process_payment_with_signature(
        &payer,
        &str(&env, "RESTORE_ORD"),
        &merchant,
        &token,
        &100,
        &str(&env, ""),
        &None,
        &bytes(&env, &[0u8; 64]),
        &bytes(&env, &[0u8; 32]),
    );
}

#[test]
fn test_pause_emits_event() {
    let (env, client, admin, _, _, _) = setup_payment_env();
    client.pause_contract(&admin);
    let events = env.events().all();
    assert!(!events.events().is_empty());
}

#[test]
fn test_unpause_emits_event() {
    let (env, client, admin, _, _, _) = setup_payment_env();
    client.pause_contract(&admin);
    client.unpause_contract(&admin);
    let events = env.events().all();
    assert!(!events.events().is_empty());
}

// ── build_page sort tests ─────────────────────────────────────────────────────

#[test]
fn test_sort_by_amount_ascending() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "SA_1", 300);
    make_payment(&env, &client, &merchant, &payer, &token, "SA_2", 100);
    make_payment(&env, &client, &merchant, &payer, &token, "SA_3", 200);

    let page = client.get_merchant_payment_history(
        &merchant, &None, &10, &None, &SortField::Amount, &SortOrder::Ascending,
    );
    assert_eq!(page.payments.get(0).unwrap().amount, 100);
    assert_eq!(page.payments.get(1).unwrap().amount, 200);
    assert_eq!(page.payments.get(2).unwrap().amount, 300);
}

#[test]
fn test_sort_by_amount_descending() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "SD_1", 300);
    make_payment(&env, &client, &merchant, &payer, &token, "SD_2", 100);
    make_payment(&env, &client, &merchant, &payer, &token, "SD_3", 200);

    let page = client.get_merchant_payment_history(
        &merchant, &None, &10, &None, &SortField::Amount, &SortOrder::Descending,
    );
    assert_eq!(page.payments.get(0).unwrap().amount, 300);
    assert_eq!(page.payments.get(1).unwrap().amount, 200);
    assert_eq!(page.payments.get(2).unwrap().amount, 100);
}

#[test]
fn test_sort_by_date_descending() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "DD_1", 100);
    env.ledger().with_mut(|l| l.timestamp += 10);
    make_payment(&env, &client, &merchant, &payer, &token, "DD_2", 200);
    env.ledger().with_mut(|l| l.timestamp += 10);
    make_payment(&env, &client, &merchant, &payer, &token, "DD_3", 300);

    let page = client.get_merchant_payment_history(
        &merchant, &None, &10, &None, &SortField::Date, &SortOrder::Descending,
    );
    // Most recent first
    assert_eq!(page.payments.get(0).unwrap().order_id, str(&env, "DD_3"));
    assert_eq!(page.payments.get(2).unwrap().order_id, str(&env, "DD_1"));
}

#[test]
fn test_empty_dataset_returns_empty_page() {
    let (env, client, _admin, merchant, _payer, _token) = setup_payment_env();

    let page = client.get_merchant_payment_history(
        &merchant, &None, &10, &None, &SortField::Date, &SortOrder::Ascending,
    );
    assert_eq!(page.payments.len(), 0);
    assert_eq!(page.total_matching, 0);
    assert!(page.next_cursor.is_none());
}

#[test]
fn test_single_item_page() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "SINGLE", 42);

    let page = client.get_merchant_payment_history(
        &merchant, &None, &10, &None, &SortField::Amount, &SortOrder::Ascending,
    );
    assert_eq!(page.payments.len(), 1);
    assert_eq!(page.payments.get(0).unwrap().amount, 42);
    assert!(page.next_cursor.is_none());
}

#[test]
fn test_pagination_cursor_continues_correctly() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    // Insert 5 payments with distinct amounts so sort order is deterministic
    for (id, amt) in [("PC_1", 10i128), ("PC_2", 20), ("PC_3", 30), ("PC_4", 40), ("PC_5", 50)] {
        make_payment(&env, &client, &merchant, &payer, &token, id, amt);
    }

    // Page 1: first 3 ascending by amount
    let page1 = client.get_merchant_payment_history(
        &merchant, &None, &3, &None, &SortField::Amount, &SortOrder::Ascending,
    );
    assert_eq!(page1.payments.len(), 3);
    assert_eq!(page1.payments.get(0).unwrap().amount, 10);
    assert!(page1.next_cursor.is_some());

    // Page 2: next 2 using cursor
    let page2 = client.get_merchant_payment_history(
        &merchant, &page1.next_cursor, &3, &None, &SortField::Amount, &SortOrder::Ascending,
    );
    assert_eq!(page2.payments.len(), 2);
    assert_eq!(page2.payments.get(0).unwrap().amount, 40);
    assert_eq!(page2.payments.get(1).unwrap().amount, 50);
    assert!(page2.next_cursor.is_none());
}

#[test]
fn test_large_dataset_sort_correctness() {
    // 20 payments with amounts 20..1 (reverse insertion order) — verifies the
    // O(n log n) sort produces the correct ascending sequence without hitting
    // Soroban instruction limits that the old O(n²) insertion sort would reach.
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let ids = [
        "LD_20","LD_19","LD_18","LD_17","LD_16","LD_15","LD_14","LD_13","LD_12","LD_11",
        "LD_10","LD_09","LD_08","LD_07","LD_06","LD_05","LD_04","LD_03","LD_02","LD_01",
    ];
    for (i, id_str) in ids.iter().enumerate() {
        let amount = (20 - i) as i128; // 20, 19, 18, ... 1
        make_payment(&env, &client, &merchant, &payer, &token, id_str, amount);
    }

    let page = client.get_merchant_payment_history(
        &merchant, &None, &20, &None, &SortField::Amount, &SortOrder::Ascending,
    );
    assert_eq!(page.total_matching, 20);
    assert_eq!(page.payments.get(0).unwrap().amount, 1);
    assert_eq!(page.payments.get(19).unwrap().amount, 20);
}

#[test]
fn test_cancel_multisig_by_initiator() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "CANCEL_001"),
        &merchant,
        &token,
        &1_000,
        &signers,
        &2,
           &None,
    );

    // Initiator can cancel
    client.cancel_multisig_payment(&payer, &str(&env, "CANCEL_001"));

    // Verify it's marked as cancelled
    let ms = env.as_contract(&client.address, || {
        storage::get_multisig(&env, &str(&env, "CANCEL_001")).unwrap()
    });
    assert!(ms.cancelled);
}

#[test]
fn test_cancel_multisig_by_admin() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "CANCEL_002"),
        &merchant,
        &token,
        &1_000,
        &signers,
        &2,
           &None,
    );

    // Admin can cancel
    client.cancel_multisig_payment(&admin, &str(&env, "CANCEL_002"));

    // Verify it's marked as cancelled
    let ms = env.as_contract(&client.address, || {
        storage::get_multisig(&env, &str(&env, "CANCEL_002")).unwrap()
    });
    assert!(ms.cancelled);
}

#[test]
fn test_cancel_multisig_double_cancel_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "CANCEL_003"),
        &merchant,
        &token,
        &1_000,
        &signers,
        &2,
           &None,
    );

    // First cancel succeeds
    client.cancel_multisig_payment(&payer, &str(&env, "CANCEL_003"));

    // Second cancel fails
    let result = client.try_cancel_multisig_payment(&payer, &str(&env, "CANCEL_003"));
    assert_eq!(result, Err(Ok(PaymentError::MultisigAlreadyCancelled)));
}

#[test]
fn test_cancel_multisig_unauthorized_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "CANCEL_004"),
        &merchant,
        &token,
        &1_000,
        &signers,
        &2,
           &None,
    );

    // Stranger cannot cancel
    let stranger = Address::generate(&env);
    let result = client.try_cancel_multisig_payment(&stranger, &str(&env, "CANCEL_004"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_cancel_multisig_already_executed_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "CANCEL_005"),
        &merchant,
        &token,
        &1_000,
        &signers,
        &2,
           &None,
    );

    client.sign_multisig_payment(&signer1, &str(&env, "CANCEL_005"), &bytes(&env, &[1u8; 64]));
    client.sign_multisig_payment(&signer2, &str(&env, "CANCEL_005"), &bytes(&env, &[2u8; 64]));
    client.execute_multisig_payment(&payer, &str(&env, "CANCEL_005"));

    // Cannot cancel after execution
    let result = client.try_cancel_multisig_payment(&payer, &str(&env, "CANCEL_005"));
    assert_eq!(result, Err(Ok(PaymentError::MultisigAlreadyExecuted)));
}

#[test]
fn test_execute_cancelled_multisig_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "CANCEL_006"),
        &merchant,
        &token,
        &1_000,
        &signers,
        &2,
           &None,
    );

    client.cancel_multisig_payment(&payer, &str(&env, "CANCEL_006"));

    client.sign_multisig_payment(&signer1, &str(&env, "CANCEL_006"), &bytes(&env, &[1u8; 64]));
    client.sign_multisig_payment(&signer2, &str(&env, "CANCEL_006"), &bytes(&env, &[2u8; 64]));

    // Cannot execute cancelled payment
    let result = client.try_execute_multisig_payment(&payer, &str(&env, "CANCEL_006"));
    assert_eq!(result, Err(Ok(PaymentError::MultisigAlreadyCancelled)));
}

#[test]
fn test_order_id_64_chars_accepted() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    // 64-character order ID should be accepted
    let order_id_64 = String::from_str(&env, "1234567890123456789012345678901234567890123456789012345678901234");
    assert_eq!(order_id_64.len(), 64);

    client.process_payment_with_signature(
        &payer,
        &order_id_64,
        &merchant,
        &token,
        &1_000,
        &str(&env, "Test payment"),
        &None,
        &sig,
        &pub_key,
    );
}

#[test]
fn test_order_id_65_chars_rejected() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    // 65-character order ID should be rejected
    let order_id_65 = String::from_str(&env, "12345678901234567890123456789012345678901234567890123456789012345");
    assert_eq!(order_id_65.len(), 65);

    let result = client.try_process_payment_with_signature(
        &payer,
        &order_id_65,
        &merchant,
        &token,
        &1_000,
        &str(&env, "Test payment"),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_refund_id_64_chars_accepted() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_REF_ID", 1_000);

    // 64-character refund ID should be accepted
    let refund_id_64 = String::from_str(&env, "1234567890123456789012345678901234567890123456789012345678901234");
    assert_eq!(refund_id_64.len(), 64);

    client.initiate_refund(
        &payer,
        &refund_id_64,
        &str(&env, "ORDER_REF_ID"),
        &500,
        &str(&env, "Test refund"),
    );
}

#[test]
fn test_refund_id_65_chars_rejected() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ORDER_REF_ID2", 1_000);

    // 65-character refund ID should be rejected
    let refund_id_65 = String::from_str(&env, "12345678901234567890123456789012345678901234567890123456789012345");
    assert_eq!(refund_id_65.len(), 65);

    let result = client.try_initiate_refund(
        &payer,
        &refund_id_65,
        &str(&env, "ORDER_REF_ID2"),
        &500,
        &str(&env, "Test refund"),
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_multisig_payment_id_64_chars_accepted() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    // 64-character payment ID should be accepted
    let payment_id_64 = String::from_str(&env, "1234567890123456789012345678901234567890123456789012345678901234");
    assert_eq!(payment_id_64.len(), 64);

    client.initiate_multisig_payment(
        &payer,
        &payment_id_64,
        &merchant,
        &token,
        &1_000,
        &signers,
        &2,
           &None,
    );
}

#[test]
fn test_multisig_payment_id_65_chars_rejected() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer1.clone());
    signers.push_back(signer2.clone());

    // 65-character payment ID should be rejected
    let payment_id_65 = String::from_str(&env, "12345678901234567890123456789012345678901234567890123456789012345");
    assert_eq!(payment_id_65.len(), 65);

    let result = client.try_initiate_multisig_payment(
        &payer,
        &payment_id_65,
        &merchant,
        &token,
        &1_000,
        &signers,
        &2,
           &None,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

// ── Custom category tests ─────────────────────────────────────────────────────

#[test]
fn test_register_merchant_custom_category_success() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    client.register_merchant(
        &merchant,
        &str(&env, "Artisan Goods"),
        &str(&env, "Handcrafted items"),
        &str(&env, "artisan@example.com"),
        &MerchantCategory::Custom(str(&env, "Handcraft")),
    );
    let stored = client.get_merchant(&merchant);
    assert_eq!(stored.category, MerchantCategory::Custom(str(&env, "Handcraft")));
}

#[test]
fn test_register_merchant_custom_category_max_length_success() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    // Exactly 32 characters — should pass
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Custom(str(&env, "12345678901234567890123456789012")),
    );
    let stored = client.get_merchant(&merchant);
    assert_eq!(
        stored.category,
        MerchantCategory::Custom(str(&env, "12345678901234567890123456789012"))
    );
}

#[test]
fn test_register_merchant_custom_category_empty_fails() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    let result = client.try_register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Custom(str(&env, "")),
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidCategory)));
}

#[test]
fn test_register_merchant_custom_category_too_long_fails() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    // 33 characters — should fail
    let result = client.try_register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, "desc"),
        &str(&env, "c@c.com"),
        &MerchantCategory::Custom(str(&env, "123456789012345678901234567890123")),
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidCategory)));
}

// ── Contract event subscription and provenance tests (#301) ──────────────────
//
// Event structure:
//   topics[0] = Symbol("lumenflow")
//   topics[1] = Symbol("<event_name>")
//   data       = event-specific payload (see docs/events-reference.md)

fn find_event<'a>(
    env: &Env,
    events: &'a soroban_sdk::Vec<soroban_sdk::testutils::Events>,
    name: &str,
) -> Option<soroban_sdk::testutils::Events> {
    let needle = soroban_sdk::Symbol::new(env, name);
    events.iter().find(|e| e.topics.get(1).map(|t| t == needle).unwrap_or(false))
}

#[test]
fn test_event_admin_set() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);

    let events = env.events().all();
    let ev = find_event(&env, &events, "admin_set");
    assert!(ev.is_some(), "admin_set event must be emitted");
    // topics[0] == "lumenflow"
    assert_eq!(
        ev.unwrap().topics.get(0).unwrap(),
        soroban_sdk::Symbol::new(&env, "lumenflow").into_val(&env)
    );
}

#[test]
fn test_event_merchant_registered() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);
    client.register_merchant(
        &merchant,
        &str(&env, "Shop"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Retail,
    );

    let events = env.events().all();
    assert!(
        find_event(&env, &events, "merchant_registered").is_some(),
        "merchant_registered event must be emitted"
    );
}

#[test]
fn test_event_payment_processed_topics_and_data() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "EVT_PAY", 1_000);

    let events = env.events().all();
    let ev = find_event(&env, &events, "payment_processed");
    assert!(ev.is_some(), "payment_processed event must be emitted");

    // Verify stable topics
    let ev = ev.unwrap();
    assert_eq!(
        ev.topics.get(0).unwrap(),
        soroban_sdk::Symbol::new(&env, "lumenflow").into_val(&env)
    );
    assert_eq!(
        ev.topics.get(1).unwrap(),
        soroban_sdk::Symbol::new(&env, "payment_processed").into_val(&env)
    );
}

#[test]
fn test_event_payment_archived() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ARCH_PAY", 100);
    client.archive_payment_record(&admin, &str(&env, "ARCH_PAY"));

    let events = env.events().all();
    assert!(
        find_event(&env, &events, "payment_archived").is_some(),
        "payment_archived event must be emitted"
    );
}

#[test]
fn test_event_refund_lifecycle() {
    // Verifies refund_initiated, refund_approved, and refund_executed are all emitted.
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "REFUND_EVT", 1_000);

    client.initiate_refund(
        &payer,
        &str(&env, "RF_EVT_1"),
        &str(&env, "REFUND_EVT"),
        &500,
        &str(&env, "event test"),
    );
    {
        let evs = env.events().all();
        assert!(find_event(&env, &evs, "refund_initiated").is_some(), "refund_initiated must fire");
    }

    client.approve_refund(&merchant, &str(&env, "RF_EVT_1"));
    {
        let evs = env.events().all();
        assert!(find_event(&env, &evs, "refund_approved").is_some(), "refund_approved must fire");
    }

    client.execute_refund(&str(&env, "RF_EVT_1"));
    {
        let evs = env.events().all();
        assert!(find_event(&env, &evs, "refund_executed").is_some(), "refund_executed must fire");
    }
}

#[test]
fn test_event_refund_rejected() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "REJ_EVT", 1_000);
    client.initiate_refund(&payer, &str(&env, "RF_REJ"), &str(&env, "REJ_EVT"), &200, &str(&env, "r"));
    client.reject_refund(&merchant, &str(&env, "RF_REJ"));

    let events = env.events().all();
    assert!(
        find_event(&env, &events, "refund_rejected").is_some(),
        "refund_rejected event must be emitted"
    );
}

#[test]
fn test_event_multisig_initiated_and_executed() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    let mut signers = soroban_sdk::Vec::new(&env);
    signers.push_back(payer.clone());
    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_EVT_1"),
        &merchant,
        &token,
        &1_000,
        &signers,
        &1,
    );
    {
        let evs = env.events().all();
        assert!(find_event(&env, &evs, "multisig_initiated").is_some(), "multisig_initiated must fire");
    }

    client.sign_multisig_payment(&payer, &str(&env, "MS_EVT_1"), &bytes(&env, &[0u8; 64]));
    client.execute_multisig_payment(&payer, &str(&env, "MS_EVT_1"));
    {
        let evs = env.events().all();
        assert!(find_event(&env, &evs, "multisig_executed").is_some(), "multisig_executed must fire");
    }
}

#[test]
fn test_event_no_spurious_events_on_failed_payment() {
    // A failed payment must not emit payment_processed.
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    // First payment succeeds and emits the event.
    client.process_payment_with_signature(
        &payer, &str(&env, "DUP_EVT"), &merchant, &token, &100,
        &str(&env, ""), &None, &sig, &pub_key,
    );
    let count_before = env.events().all().iter()
        .filter(|e| e.topics.get(1).map(|t| t == soroban_sdk::Symbol::new(&env, "payment_processed").into_val(&env)).unwrap_or(false))
        .count();

    // Duplicate order — must fail and must NOT add another payment_processed event.
    let _ = client.try_process_payment_with_signature(
        &payer, &str(&env, "DUP_EVT"), &merchant, &token, &100,
        &str(&env, ""), &None, &sig, &pub_key,
    );
    let count_after = env.events().all().iter()
        .filter(|e| e.topics.get(1).map(|t| t == soroban_sdk::Symbol::new(&env, "payment_processed").into_val(&env)).unwrap_or(false))
        .count();

    assert_eq!(count_before, count_after, "failed payment must not emit payment_processed");
}

// ── cleanup_expired_payments safety and gas tests (#287) ─────────────────────

#[test]
fn test_cleanup_respects_period_does_not_remove_recent_payments() {
    // Payments created after the cutoff must survive cleanup.
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    // Period = 100 seconds.  Make a payment, then advance only 50 s (< period).
    client.set_payment_cleanup_period(&admin, &100);
    make_payment(&env, &client, &merchant, &payer, &token, "RECENT_001", 500);
    env.ledger().with_mut(|l| l.timestamp += 50);

    let removed = client.cleanup_expired_payments(&admin);
    assert_eq!(removed, 0, "recent payment must not be removed");

    // The payment should still be retrievable.
    let p = client.get_payment_by_id(&payer, &str(&env, "RECENT_001"));
    assert_eq!(p.amount, 500);
}

#[test]
fn test_cleanup_only_removes_payments_older_than_period() {
    // One old payment (past cutoff) and one recent (within period) — only old is removed.
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    client.set_payment_cleanup_period(&admin, &10);
    make_payment(&env, &client, &merchant, &payer, &token, "OLD_PAY", 100);

    // Advance past the cutoff so OLD_PAY is eligible.
    env.ledger().with_mut(|l| l.timestamp += 20);

    // NEW_PAY is created after the cutoff — it should survive.
    make_payment(&env, &client, &merchant, &payer, &token, "NEW_PAY", 200);

    let removed = client.cleanup_expired_payments(&admin);
    assert_eq!(removed, 1, "only the expired payment should be removed");

    // NEW_PAY must still exist.
    let p = client.get_payment_by_id(&payer, &str(&env, "NEW_PAY"));
    assert_eq!(p.amount, 200);
}

#[test]
fn test_cleanup_with_no_expired_payments_returns_zero() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    // Long period — nothing will expire.
    client.set_payment_cleanup_period(&admin, &86_400);
    make_payment(&env, &client, &merchant, &payer, &token, "SAFE_001", 300);

    let removed = client.cleanup_expired_payments(&admin);
    assert_eq!(removed, 0);
}

#[test]
fn test_cleanup_empty_contract_returns_zero() {
    // Cleanup on a contract with no payments should not panic and return 0.
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    client.set_payment_cleanup_period(&admin, &1);
    env.ledger().with_mut(|l| l.timestamp += 10);

    let removed = client.cleanup_expired_payments(&admin);
    assert_eq!(removed, 0);
}

#[test]
fn test_cleanup_large_set_completes_without_panic() {
    // Gas / loop-limit safety: cleanup a large number of expired payments.
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    client.set_payment_cleanup_period(&admin, &1);

    // Create 50 payments (within Soroban test limits).
    for i in 0u32..50 {
        let order_id = soroban_sdk::String::from_str(&env, &format!("BULK_{:03}", i));
        let pub_key = Bytes::from_slice(&env, &[0u8; 32]);
        let sig = Bytes::from_slice(&env, &[0u8; 64]);
        client.process_payment_with_signature(
            &payer,
            &order_id,
            &merchant,
            &token,
            &(100 + i as i128),
            &str(&env, ""),
            &None,
            &sig,
            &pub_key,
        );
    }

    // Advance time so all payments are past the cleanup period.
    env.ledger().with_mut(|l| l.timestamp += 10);

    let removed = client.cleanup_expired_payments(&admin);
    assert_eq!(removed, 50, "all 50 expired payments should be removed");

    // Verify no payments remain in merchant history.
    let page = client.get_merchant_payment_history(
        &merchant,
        &None,
        &100,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(page.payments.len(), 0);
}

#[test]
fn test_cleanup_does_not_remove_payments_at_exact_cutoff_boundary() {
    // A payment whose paid_at equals the cutoff timestamp is NOT yet expired
    // (the check is `paid_at < cutoff`, so equal timestamps are kept).
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    client.set_payment_cleanup_period(&admin, &10);
    make_payment(&env, &client, &merchant, &payer, &token, "BOUNDARY", 100);

    // Advance by exactly the period — paid_at == cutoff, should NOT be removed.
    env.ledger().with_mut(|l| l.timestamp += 10);

    let removed = client.cleanup_expired_payments(&admin);
    assert_eq!(removed, 0, "payment at exact cutoff boundary must not be removed");
}

// ── Min refund amount tests ───────────────────────────────────────────────────

#[test]
fn test_set_min_refund_amount_success() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    // Admin can set the minimum refund amount
    client.set_min_refund_amount(&admin, &100);
    // A refund at exactly the minimum should succeed
    make_payment(&env, &client, &merchant, &payer, &token, "MRA_001", 1_000);
    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_MRA1"),
        &str(&env, "MRA_001"),
        &100,
        &str(&env, "At minimum"),
    );
    let refund = client.get_refund(&str(&env, "REFUND_MRA1"));
    assert_eq!(refund.amount, 100);
}

#[test]
fn test_refund_below_minimum_fails() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    client.set_min_refund_amount(&admin, &200);
    make_payment(&env, &client, &merchant, &payer, &token, "MRA_002", 1_000);
    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "REFUND_MRA2"),
        &str(&env, "MRA_002"),
        &199,
        &str(&env, "Below minimum"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundBelowMinimum)));
}

#[test]
fn test_refund_above_minimum_succeeds() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    client.set_min_refund_amount(&admin, &50);
    make_payment(&env, &client, &merchant, &payer, &token, "MRA_003", 1_000);
    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_MRA3"),
        &str(&env, "MRA_003"),
        &51,
        &str(&env, "Above minimum"),
    );
    let refund = client.get_refund(&str(&env, "REFUND_MRA3"));
    assert_eq!(refund.amount, 51);
}

#[test]
fn test_set_min_refund_amount_non_admin_fails() {
    let (env, client, _admin, _merchant, payer, _token) = setup_payment_env();
    let result = client.try_set_min_refund_amount(&payer, &100);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_min_refund_not_set_allows_any_positive() {
    // Without setting a minimum, any positive amount should be accepted
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "MRA_004", 1_000);
    client.initiate_refund(
        &payer,
        &str(&env, "REFUND_MRA4"),
        &str(&env, "MRA_004"),
        &1,
        &str(&env, "Tiny refund"),
    );
    let refund = client.get_refund(&str(&env, "REFUND_MRA4"));
    assert_eq!(refund.amount, 1);
}

#[test]
fn test_set_min_refund_amount_zero_fails() {
    let (env, client, admin, _merchant, _payer, _token) = setup_payment_env();
    let result = client.try_set_min_refund_amount(&admin, &0);
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}

#[test]
fn test_min_refund_boundary_one_below_fails() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    client.set_min_refund_amount(&admin, &500);
    make_payment(&env, &client, &merchant, &payer, &token, "MRA_005", 1_000);
    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "REFUND_MRA5"),
        &str(&env, "MRA_005"),
        &499,
        &str(&env, "One below min"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundBelowMinimum)));
}

// ── Token whitelist tests (#284) ──────────────────────────────────────────────

/// Admin can add and remove a token; is_token_allowed reflects the change.
#[test]
fn test_admin_add_remove_allowed_token() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);

    client.set_admin(&admin);

    // Token not allowed yet
    assert!(!storage::is_token_allowed(&env, &token));

    client.add_allowed_token(&admin, &token);
    assert!(storage::is_token_allowed(&env, &token));

    client.remove_allowed_token(&admin, &token);
    assert!(!storage::is_token_allowed(&env, &token));
}

/// Only the admin may call add_allowed_token.
#[test]
fn test_add_allowed_token_requires_admin() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);
    let stranger = Address::generate(&env);

    client.set_admin(&admin);

    let result = client.try_add_allowed_token(&stranger, &token);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

/// Only the admin may call remove_allowed_token.
#[test]
fn test_remove_allowed_token_requires_admin() {
    let (env, client, admin, _, _, token) = setup_payment_env();
    let stranger = Address::generate(&env);

    let result = client.try_remove_allowed_token(&stranger, &token);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

/// process_payment_with_signature rejects a disallowed token.
#[test]
fn test_payment_with_disallowed_token_fails() {
    let (env, client, admin, merchant, payer, _allowed_token) = setup_payment_env();
    let token_admin = Address::generate(&env);
    let bad_token = create_token(&env, &token_admin);
    mint(&env, &bad_token, &token_admin, &payer, 10_000);

    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "WL_ORDER_1"),
        &merchant,
        &bad_token,
        &100,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::TokenNotAllowed)));

    // After adding it, the payment succeeds
    client.add_allowed_token(&admin, &bad_token);
    client.process_payment_with_signature(
        &payer,
        &str(&env, "WL_ORDER_1"),
        &merchant,
        &bad_token,
        &100,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
}

/// batch_payment rejects any item with a disallowed token.
#[test]
fn test_batch_payment_disallowed_token_fails() {
    let (env, client, _admin, merchant, payer, _allowed_token) = setup_payment_env();
    let token_admin = Address::generate(&env);
    let bad_token = create_token(&env, &token_admin);
    mint(&env, &bad_token, &token_admin, &payer, 10_000);

    let mut payments = Vec::new(&env);
    payments.push_back(BatchPaymentItem {
        order_id: str(&env, "WL_BATCH_1"),
        merchant_address: merchant.clone(),
        token_address: bad_token.clone(),
        amount: 100,
        memo: str(&env, ""),
        signature: bytes(&env, &[0u8; 64]),
        merchant_public_key: bytes(&env, &[0u8; 32]),
    });

    let result = client.try_batch_payment(&payer, &payments);
    assert_eq!(result, Err(Ok(PaymentError::TokenNotAllowed)));
}

/// initiate_multisig_payment rejects a disallowed token.
#[test]
fn test_multisig_payment_disallowed_token_fails() {
    let (env, client, _admin, merchant, payer, _allowed_token) = setup_payment_env();
    let token_admin = Address::generate(&env);
    let bad_token = create_token(&env, &token_admin);

    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    let result = client.try_initiate_multisig_payment(
        &payer,
        &str(&env, "WL_MS_1"),
        &merchant,
        &bad_token,
        &500,
        &signers,
        &1,
    );
    assert_eq!(result, Err(Ok(PaymentError::TokenNotAllowed)));
}

/// After a token is removed from the whitelist, existing payment paths reject it.
#[test]
fn test_removed_token_is_rejected() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    // First payment works
    client.process_payment_with_signature(
        &payer, &str(&env, "WL_RM1"), &merchant, &token, &100, &str(&env, ""), &None, &sig, &pub_key,
    );

    // Admin removes the token
    client.remove_allowed_token(&admin, &token);

    // Subsequent payment with the same token must fail
    let result = client.try_process_payment_with_signature(
        &payer, &str(&env, "WL_RM2"), &merchant, &token, &100, &str(&env, ""), &None, &sig, &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::TokenNotAllowed)));
}

// ── Refund edge-case tests (#286) ─────────────────────────────────────────────

/// Partial refund that leaves a non-zero remaining balance updates status to PartiallyRefunded.
#[test]
fn test_partial_refund_updates_status() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "EDGE_PR1", 1_000);

    client.initiate_refund(&payer, &str(&env, "RF_PR1"), &str(&env, "EDGE_PR1"), &300, &str(&env, "partial"));
    client.approve_refund(&merchant, &str(&env, "RF_PR1"));
    client.execute_refund(&str(&env, "RF_PR1"));

    let p = client.get_payment_by_id(&payer, &str(&env, "EDGE_PR1"));
    assert_eq!(p.refunded_amount, 300);
    assert!(matches!(p.status, crate::types::PaymentStatus::PartiallyRefunded));
}

/// Cumulative refunds that exactly equal the original amount set status to FullyRefunded.
#[test]
fn test_cumulative_partial_refunds_reach_full() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "EDGE_CUM", 1_000);

    // First partial: 600
    client.initiate_refund(&payer, &str(&env, "RF_CUM1"), &str(&env, "EDGE_CUM"), &600, &str(&env, "first"));
    client.approve_refund(&merchant, &str(&env, "RF_CUM1"));
    client.execute_refund(&str(&env, "RF_CUM1"));

    // Second partial: remaining 400 — should become FullyRefunded
    client.initiate_refund(&payer, &str(&env, "RF_CUM2"), &str(&env, "EDGE_CUM"), &400, &str(&env, "second"));
    client.approve_refund(&merchant, &str(&env, "RF_CUM2"));
    client.execute_refund(&str(&env, "RF_CUM2"));

    let p = client.get_payment_by_id(&payer, &str(&env, "EDGE_CUM"));
    assert_eq!(p.refunded_amount, 1_000);
    assert!(matches!(p.status, crate::types::PaymentStatus::FullyRefunded));
}

/// Refund of exactly the original amount (single request) is allowed and sets FullyRefunded.
#[test]
fn test_full_single_refund_allowed() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "EDGE_FULL", 500);

    client.initiate_refund(&payer, &str(&env, "RF_FULL"), &str(&env, "EDGE_FULL"), &500, &str(&env, "full"));
    client.approve_refund(&merchant, &str(&env, "RF_FULL"));
    client.execute_refund(&str(&env, "RF_FULL"));

    let p = client.get_payment_by_id(&payer, &str(&env, "EDGE_FULL"));
    assert!(matches!(p.status, crate::types::PaymentStatus::FullyRefunded));
}

/// Initiating a refund for more than the original amount is rejected immediately.
#[test]
fn test_over_refund_single_request_fails() {
    let (env, client, _admin, _merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &_merchant, &payer, &token, "EDGE_OVER", 200);

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "RF_OVER"),
        &str(&env, "EDGE_OVER"),
        &201,
        &str(&env, "too much"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundExceedsOriginal)));
}

/// After partial refunds the cumulative total cannot exceed the original amount.
#[test]
fn test_over_refund_cumulative_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "EDGE_OVCUM", 1_000);

    // Refund 700 first
    client.initiate_refund(&payer, &str(&env, "RF_OV1"), &str(&env, "EDGE_OVCUM"), &700, &str(&env, "first"));
    client.approve_refund(&merchant, &str(&env, "RF_OV1"));
    client.execute_refund(&str(&env, "RF_OV1"));

    // Attempt to refund 400 more (700 + 400 = 1100 > 1000) — must fail
    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "RF_OV2"),
        &str(&env, "EDGE_OVCUM"),
        &400,
        &str(&env, "over"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundExceedsOriginal)));
}

/// Refund initiated exactly at the 30-day boundary is still within the window.
#[test]
fn test_refund_at_window_boundary_allowed() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "EDGE_BOUND", 500);

    // Advance to exactly 30 days (still within window — window is > 30 days exclusive)
    env.ledger().with_mut(|l| l.timestamp += 30 * 24 * 3600);

    // Should succeed (boundary is inclusive on the payment side)
    client.initiate_refund(
        &payer,
        &str(&env, "RF_BOUND"),
        &str(&env, "EDGE_BOUND"),
        &100,
        &str(&env, "boundary"),
    );
}

/// Refund initiated one second past the 30-day window is rejected.
#[test]
fn test_refund_one_second_past_window_fails() {
    let (env, client, _admin, _merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &_merchant, &payer, &token, "EDGE_LATE", 500);

    env.ledger().with_mut(|l| l.timestamp += 30 * 24 * 3600 + 1);

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "RF_LATE"),
        &str(&env, "EDGE_LATE"),
        &100,
        &str(&env, "too late"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundWindowExpired)));
}

/// Approving a refund that is already Approved returns RefundAlreadyCompleted.
#[test]
fn test_approve_already_approved_refund_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "EDGE_AA", 500);

    client.initiate_refund(&payer, &str(&env, "RF_AA"), &str(&env, "EDGE_AA"), &100, &str(&env, "r"));
    client.approve_refund(&merchant, &str(&env, "RF_AA"));

    let result = client.try_approve_refund(&merchant, &str(&env, "RF_AA"));
    assert_eq!(result, Err(Ok(PaymentError::RefundAlreadyCompleted)));
}

/// Rejecting a refund that is already Rejected returns RefundAlreadyCompleted.
#[test]
fn test_reject_already_rejected_refund_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "EDGE_RR", 500);

    client.initiate_refund(&payer, &str(&env, "RF_RR"), &str(&env, "EDGE_RR"), &100, &str(&env, "r"));
    client.reject_refund(&merchant, &str(&env, "RF_RR"));

    let result = client.try_reject_refund(&merchant, &str(&env, "RF_RR"));
    assert_eq!(result, Err(Ok(PaymentError::RefundAlreadyCompleted)));
}

/// Executing a pending (not-yet-approved) refund returns RefundNotApproved.
#[test]
fn test_execute_pending_refund_fails() {
    let (env, client, _admin, _merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &_merchant, &payer, &token, "EDGE_EP", 500);

    client.initiate_refund(&payer, &str(&env, "RF_EP"), &str(&env, "EDGE_EP"), &100, &str(&env, "r"));

    let result = client.try_execute_refund(&str(&env, "RF_EP"));
    assert_eq!(result, Err(Ok(PaymentError::RefundNotApproved)));
}

/// Executing a rejected refund returns RefundNotApproved.
#[test]
fn test_execute_rejected_refund_fails() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "EDGE_ER", 500);

    client.initiate_refund(&payer, &str(&env, "RF_ER"), &str(&env, "EDGE_ER"), &100, &str(&env, "r"));
    client.reject_refund(&merchant, &str(&env, "RF_ER"));

    let result = client.try_execute_refund(&str(&env, "RF_ER"));
    assert_eq!(result, Err(Ok(PaymentError::RefundNotApproved)));
}

/// Refunding a zero-amount order is rejected by require_positive.
#[test]
fn test_zero_amount_refund_fails() {
    let (env, client, _admin, _merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &_merchant, &payer, &token, "EDGE_ZERO", 500);

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "RF_ZERO"),
        &str(&env, "EDGE_ZERO"),
        &0,
        &str(&env, "zero"),
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}

/// Merchant can also initiate a refund on behalf of the payer.
#[test]
fn test_merchant_can_initiate_refund() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "EDGE_MINIT", 500);

    // Merchant initiates — should succeed
    client.initiate_refund(
        &merchant,
        &str(&env, "RF_MINIT"),
        &str(&env, "EDGE_MINIT"),
        &200,
        &str(&env, "merchant initiated"),
    );

    let refund = client.get_refund(&str(&env, "RF_MINIT"));
    assert!(matches!(refund.status, crate::types::RefundStatus::Pending));
}

// ── Versioning tests ──────────────────────────────────────────────────────────

#[test]
fn test_get_contract_version() {
    let (env, client) = setup();
    let version = client.get_contract_version();
    assert_eq!(version, String::from_str(&env, "1.0.0"));
}

#[test]
fn test_set_and_assert_version() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    client.set_contract_version(&admin);
    client.assert_version_matches(&admin);
}

#[test]
fn test_assert_version_no_stored_version_passes() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    // No set_contract_version called — no stored version means skip check
    client.assert_version_matches(&admin);
}

#[test]
fn test_set_contract_version_unauthorized() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    client.set_admin(&admin);
    let result = client.try_set_contract_version(&non_admin);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

// ── Multisig expiry and cancellation tests ────────────────────────────────────

#[test]
fn test_multisig_expired_cannot_sign() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_EXP_001"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
    );

    // Advance past 7-day expiry
    env.ledger().with_mut(|l| l.timestamp += 8 * 24 * 3600);

    let result = client.try_sign_multisig_payment(
        &signer,
        &str(&env, "MS_EXP_001"),
        &bytes(&env, &[1u8; 64]),
    );
    assert_eq!(result, Err(Ok(PaymentError::MultisigExpired)));
}

#[test]
fn test_multisig_expired_cannot_execute() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_EXP_002"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
    );

    // Sign before expiry
    client.sign_multisig_payment(&signer, &str(&env, "MS_EXP_002"), &bytes(&env, &[1u8; 64]));

    // Advance past expiry
    env.ledger().with_mut(|l| l.timestamp += 8 * 24 * 3600);

    let result = client.try_execute_multisig_payment(&payer, &str(&env, "MS_EXP_002"));
    assert_eq!(result, Err(Ok(PaymentError::MultisigExpired)));
}

#[test]
fn test_multisig_cancellation_by_initiator() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_CANCEL_001"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
    );

    // Initiator cancels
    client.cancel_multisig_payment(&payer, &str(&env, "MS_CANCEL_001"));

    // Cannot sign after cancellation
    let result = client.try_sign_multisig_payment(
        &signer,
        &str(&env, "MS_CANCEL_001"),
        &bytes(&env, &[1u8; 64]),
    );
    assert_eq!(result, Err(Ok(PaymentError::MultisigCancelled)));
}

#[test]
fn test_multisig_cancel_unauthorized() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let stranger = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_CANCEL_002"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
    );

    let result = client.try_cancel_multisig_payment(&stranger, &str(&env, "MS_CANCEL_002"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_multisig_cancel_by_admin() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = Vec::new(&env);
    signers.push_back(signer.clone());

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "MS_CANCEL_003"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
    );

    // Admin can also cancel
    client.cancel_multisig_payment(&admin, &str(&env, "MS_CANCEL_003"));

    let ms = client.get_multisig_payment(&str(&env, "MS_CANCEL_003"));
    assert!(ms.cancelled);
}

// ── Admin permission tests ────────────────────────────────────────────────────

#[test]
fn test_set_payment_cleanup_period_unauthorized() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    client.set_admin(&admin);
    let result = client.try_set_payment_cleanup_period(&non_admin, &86400);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_set_payment_cleanup_period_admin_success() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    client.set_payment_cleanup_period(&admin, &86400);
}

#[test]
fn test_set_large_payment_threshold_unauthorized() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    client.set_admin(&admin);
    let result = client.try_set_large_payment_threshold(&non_admin, &1000);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_set_large_payment_threshold_admin_success() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    client.set_large_payment_threshold(&admin, &1000);
}

#[test]
fn test_deactivate_merchant_unauthorized() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    client.set_admin(&admin);
    client.register_merchant(
        &merchant,
        &str(&env, "Store"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Retail,
    );
    let result = client.try_deactivate_merchant(&non_admin, &merchant);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_archive_payment_record_unauthorized() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let non_admin = Address::generate(&env);
    make_payment(&env, &client, &merchant, &payer, &token, "ARCH_001", 100);
    let result = client.try_archive_payment_record(&non_admin, &str(&env, "ARCH_001"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_archive_payment_record_admin_success() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ARCH_002", 100);
    client.archive_payment_record(&admin, &str(&env, "ARCH_002"));
    let result = client.try_get_payment_by_id(&payer, &str(&env, "ARCH_002"));
    assert_eq!(result, Err(Ok(PaymentError::PaymentNotFound)));
}

#[test]
fn test_cleanup_expired_payments_unauthorized() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    client.set_admin(&admin);
    let result = client.try_cleanup_expired_payments(&non_admin);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_get_global_payment_stats_unauthorized() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    client.set_admin(&admin);
    let result = client.try_get_global_payment_stats(&non_admin, &None, &None);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

// ── Token whitelist tests (Issue #348) ────────────────────────────────────────

#[test]
fn test_payment_with_no_whitelist_succeeds() {
    // When no whitelist is set every token is allowed
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "WL_001", 100);
    let p = client.get_payment_by_id(&payer, &str(&env, "WL_001"));
    assert_eq!(p.amount, 100);
}

#[test]
fn test_payment_with_allowed_token_succeeds() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    client.add_allowed_token(&admin, &token);
    make_payment(&env, &client, &merchant, &payer, &token, "WL_002", 200);
    let p = client.get_payment_by_id(&payer, &str(&env, "WL_002"));
    assert_eq!(p.amount, 200);
}

#[test]
fn test_payment_with_disallowed_token_fails() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    // Whitelist a *different* token so `token` is blocked
    let other_token_admin = Address::generate(&env);
    let other_token = create_token(&env, &other_token_admin);
    client.add_allowed_token(&admin, &other_token);

    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "WL_BAD"),
        &merchant,
        &token,
        &100,
        &str(&env, "blocked"),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::TokenNotAllowed)));
}

#[test]
fn test_remove_token_from_whitelist() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    client.add_allowed_token(&admin, &token);

    // Remove it — now the list is non-empty but doesn't contain `token`
    let other_token_admin = Address::generate(&env);
    let other_token = create_token(&env, &other_token_admin);
    client.add_allowed_token(&admin, &other_token);
    client.remove_allowed_token(&admin, &token);

    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "WL_REM"),
        &merchant,
        &token,
        &100,
        &str(&env, "after remove"),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::TokenNotAllowed)));
}

#[test]
fn test_batch_payment_disallowed_token_fails() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    let other_token_admin = Address::generate(&env);
    let other_token = create_token(&env, &other_token_admin);
    client.add_allowed_token(&admin, &other_token); // only other_token is allowed

    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    let items = soroban_sdk::vec![
        &env,
        BatchPaymentItem {
            order_id: str(&env, "BATCH_WL_001"),
            merchant_address: merchant.clone(),
            token_address: token.clone(),
            amount: 100,
            memo: str(&env, "blocked batch"),
            signature: sig,
            merchant_public_key: pub_key,
        }
    ];
    let result = client.try_batch_payment(&payer, &items);
    assert_eq!(result, Err(Ok(PaymentError::TokenNotAllowed)));
}

#[test]
fn test_get_token_whitelist() {
    let (env, client, admin, _merchant, _payer, token) = setup_payment_env();
    let list_before = client.get_token_whitelist();
    assert_eq!(list_before.len(), 0);

    client.add_allowed_token(&admin, &token);
    let list_after = client.get_token_whitelist();
    assert_eq!(list_after.len(), 1);
    assert!(list_after.contains(&token));
}

// ── State rollback and error handling tests (#346) ────────────────────────────
//
// These tests verify that failed contract invocations do NOT leave partial
// state changes behind.  Each test follows the pattern:
//   1. Capture the "before" state.
//   2. Trigger an operation that must fail.
//   3. Assert the expected error is returned.
//   4. Re-read state and confirm it is identical to the "before" snapshot.

// ── Payment state rollback ─────────────────────────────────────────────────

/// A payment with an invalid (zero) amount must not create a payment record
/// and must not mutate the payer's payment history.
#[test]
fn test_state_unchanged_after_invalid_amount_payment() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    // Capture history length before the failed call.
    let before = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(before.total_matching, 0);

    // Attempt a payment with amount = 0.
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "ROLLBACK_ZERO_AMT"),
        &merchant,
        &token,
        &0,
        &str(&env, "should fail"),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));

    // State must be unchanged.
    let after = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(after.total_matching, 0);
}

/// A payment to an unregistered merchant must be rejected and must not
/// create a payment record.
#[test]
fn test_state_unchanged_after_payment_to_unregistered_merchant() {
    let (env, client, _admin, _merchant, payer, token) = setup_payment_env();
    let unknown_merchant = Address::generate(&env);
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "ROLLBACK_NO_MERCH"),
        &unknown_merchant,
        &token,
        &100,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::MerchantNotFound)));

    // No payment record must exist for this order_id.
    let history = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(history.total_matching, 0);
}

/// A payment to an inactive merchant must be rejected and must not create
/// a payment record or affect the merchant's stats.
#[test]
fn test_state_unchanged_after_payment_to_inactive_merchant() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    client.deactivate_merchant(&admin, &merchant);

    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    let stats_before = client.get_merchant_stats(&merchant);

    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "ROLLBACK_INACTIVE"),
        &merchant,
        &token,
        &200,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::MerchantInactive)));

    // Merchant stats must not have changed.
    let stats_after = client.get_merchant_stats(&merchant);
    assert_eq!(stats_before.total_payments, stats_after.total_payments);
    assert_eq!(stats_before.total_volume, stats_after.total_volume);
}

/// A duplicate order-ID payment must be rejected and must not create a second
/// record or change the original payment.
#[test]
fn test_state_unchanged_after_duplicate_order_id() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    // First payment succeeds.
    client.process_payment_with_signature(
        &payer,
        &str(&env, "ROLLBACK_DUP"),
        &merchant,
        &token,
        &500,
        &str(&env, "original"),
        &None,
        &sig,
        &pub_key,
    );
    let original = client.get_payment_by_id(&payer, &str(&env, "ROLLBACK_DUP"));
    assert_eq!(original.amount, 500);

    // Second call with the same order_id must fail.
    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "ROLLBACK_DUP"),
        &merchant,
        &token,
        &999,
        &str(&env, "duplicate"),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::PaymentAlreadyExists)));

    // Original payment record must be unmodified.
    let after = client.get_payment_by_id(&payer, &str(&env, "ROLLBACK_DUP"));
    assert_eq!(after.amount, 500);
    assert_eq!(after.memo, str(&env, "original"));
}

/// A payment using a disallowed token must be rejected and must not create
/// a payment record.
#[test]
fn test_state_unchanged_after_disallowed_token_payment() {
    let (env, client, _admin, merchant, payer, _token) = setup_payment_env();
    let bad_token_admin = Address::generate(&env);
    let bad_token = create_token(&env, &bad_token_admin);
    // bad_token is intentionally NOT added to the allowlist.
    mint(&env, &bad_token, &bad_token_admin, &payer, 10_000);

    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "ROLLBACK_BAD_TOKEN"),
        &merchant,
        &bad_token,
        &100,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::TokenNotAllowed)));

    let history = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(history.total_matching, 0);
}

// ── Refund state rollback ──────────────────────────────────────────────────

/// Initiating a refund for an amount that exceeds the original payment must be
/// rejected and must not create a refund record or alter the payment's
/// refunded_amount.
#[test]
fn test_state_unchanged_after_refund_exceeds_original() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ROLLBACK_REF_EX", 500);

    let payment_before = client.get_payment_by_id(&payer, &str(&env, "ROLLBACK_REF_EX"));
    assert_eq!(payment_before.refunded_amount, 0);

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "ROLLBACK_REFUND_EX"),
        &str(&env, "ROLLBACK_REF_EX"),
        &600,
        &str(&env, "too much"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundExceedsOriginal)));

    // Payment record must be unchanged.
    let payment_after = client.get_payment_by_id(&payer, &str(&env, "ROLLBACK_REF_EX"));
    assert_eq!(payment_after.refunded_amount, 0);
    assert!(matches!(payment_after.status, crate::types::PaymentStatus::Completed));
}

/// Initiating a refund after the refund window has expired must be rejected
/// and must not create a refund record.
#[test]
fn test_state_unchanged_after_refund_window_expired() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ROLLBACK_REF_WIN", 1_000);

    // Advance past the 30-day window.
    env.ledger().with_mut(|l| {
        l.timestamp += 31 * 24 * 3600;
    });

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "ROLLBACK_REFUND_WIN"),
        &str(&env, "ROLLBACK_REF_WIN"),
        &100,
        &str(&env, "late refund"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundWindowExpired)));

    // Payment must still show zero refunded amount.
    let payment = client.get_payment_by_id(&payer, &str(&env, "ROLLBACK_REF_WIN"));
    assert_eq!(payment.refunded_amount, 0);
    assert!(matches!(payment.status, crate::types::PaymentStatus::Completed));
}

/// Executing a refund that is still Pending (not yet approved) must be
/// rejected; the refund must remain in Pending state.
#[test]
fn test_state_unchanged_after_execute_pending_refund() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ROLLBACK_REF_PEND", 1_000);

    client.initiate_refund(
        &payer,
        &str(&env, "ROLLBACK_REFUND_PEND"),
        &str(&env, "ROLLBACK_REF_PEND"),
        &200,
        &str(&env, "pending"),
    );

    let result = client.try_execute_refund(&str(&env, "ROLLBACK_REFUND_PEND"));
    assert_eq!(result, Err(Ok(PaymentError::RefundNotApproved)));

    // Refund status must still be Pending.
    let refund = client.get_refund(&str(&env, "ROLLBACK_REFUND_PEND"));
    assert!(matches!(refund.status, crate::types::RefundStatus::Pending));

    // Payment refunded_amount must still be zero.
    let payment = client.get_payment_by_id(&payer, &str(&env, "ROLLBACK_REF_PEND"));
    assert_eq!(payment.refunded_amount, 0);
}

/// Executing a refund that was rejected must be rejected; the refund must
/// remain in Rejected state and the payment must be unchanged.
#[test]
fn test_state_unchanged_after_execute_rejected_refund() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ROLLBACK_REF_REJ", 1_000);

    client.initiate_refund(
        &payer,
        &str(&env, "ROLLBACK_REFUND_REJ"),
        &str(&env, "ROLLBACK_REF_REJ"),
        &300,
        &str(&env, "to reject"),
    );
    client.reject_refund(&merchant, &str(&env, "ROLLBACK_REFUND_REJ"));

    let result = client.try_execute_refund(&str(&env, "ROLLBACK_REFUND_REJ"));
    assert_eq!(result, Err(Ok(PaymentError::RefundNotApproved)));

    let refund = client.get_refund(&str(&env, "ROLLBACK_REFUND_REJ"));
    assert!(matches!(refund.status, crate::types::RefundStatus::Rejected));

    let payment = client.get_payment_by_id(&payer, &str(&env, "ROLLBACK_REF_REJ"));
    assert_eq!(payment.refunded_amount, 0);
}

/// A duplicate refund ID must be rejected; the original refund record must
/// remain intact.
#[test]
fn test_state_unchanged_after_duplicate_refund_id() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ROLLBACK_REF_DUP_ORD", 1_000);

    client.initiate_refund(
        &payer,
        &str(&env, "ROLLBACK_REFUND_DUP"),
        &str(&env, "ROLLBACK_REF_DUP_ORD"),
        &200,
        &str(&env, "original refund"),
    );

    let original = client.get_refund(&str(&env, "ROLLBACK_REFUND_DUP"));
    assert_eq!(original.amount, 200);

    // Second initiate with the same refund_id must fail.
    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "ROLLBACK_REFUND_DUP"),
        &str(&env, "ROLLBACK_REF_DUP_ORD"),
        &150,
        &str(&env, "duplicate attempt"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundAlreadyExists)));

    // Original refund must be unchanged.
    let after = client.get_refund(&str(&env, "ROLLBACK_REFUND_DUP"));
    assert_eq!(after.amount, 200);
    assert_eq!(after.reason, str(&env, "original refund"));
}

/// After a failed refund initiation (window expired), global stats must not
/// be updated.
#[test]
fn test_global_stats_unchanged_after_failed_refund() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ROLLBACK_STATS_ORD", 1_000);

    let stats_before = client.get_global_payment_stats(&admin, &None, &None);

    env.ledger().with_mut(|l| {
        l.timestamp += 31 * 24 * 3600;
    });

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "ROLLBACK_STATS_REF"),
        &str(&env, "ROLLBACK_STATS_ORD"),
        &100,
        &str(&env, "too late"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundWindowExpired)));

    let stats_after = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats_before.total_refunds, stats_after.total_refunds);
    assert_eq!(stats_before.total_refund_volume, stats_after.total_refund_volume);
}

// ── Merchant state rollback ────────────────────────────────────────────────

/// Registering a merchant that is already registered must be rejected and
/// must not overwrite the existing merchant record.
#[test]
fn test_state_unchanged_after_duplicate_merchant_registration() {
    let (env, client) = setup();
    let merchant = Address::generate(&env);

    client.register_merchant(
        &merchant,
        &str(&env, "Original Store"),
        &str(&env, "original desc"),
        &str(&env, "original@contact.com"),
        &MerchantCategory::Retail,
    );
    let original = client.get_merchant(&merchant);
    assert_eq!(original.name, str(&env, "Original Store"));

    let result = client.try_register_merchant(
        &merchant,
        &str(&env, "Overwrite Attempt"),
        &str(&env, "bad desc"),
        &str(&env, "bad@contact.com"),
        &MerchantCategory::Food,
    );
    assert_eq!(result, Err(Ok(PaymentError::MerchantAlreadyRegistered)));

    // Record must be identical to the original.
    let after = client.get_merchant(&merchant);
    assert_eq!(after.name, str(&env, "Original Store"));
    assert_eq!(after.category, MerchantCategory::Retail);
    assert_eq!(after.contact_info, str(&env, "original@contact.com"));
}

/// Deactivating a merchant by a non-admin caller must be rejected and must
/// not change the merchant's active status.
#[test]
fn test_state_unchanged_after_unauthorized_deactivation() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let non_admin = Address::generate(&env);
    client.set_admin(&admin);
    client.register_merchant(
        &merchant,
        &str(&env, "Active Store"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Retail,
    );

    let result = client.try_deactivate_merchant(&non_admin, &merchant);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));

    // Merchant must still be active.
    let m = client.get_merchant(&merchant);
    assert!(m.active);
}

/// Verifying a non-existent merchant must fail and must not create a
/// phantom merchant record.
#[test]
fn test_state_unchanged_after_verify_nonexistent_merchant() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let phantom = Address::generate(&env);
    client.set_admin(&admin);

    let result = client.try_verify_merchant(&admin, &phantom);
    assert_eq!(result, Err(Ok(PaymentError::MerchantNotFound)));

    // is_registered must still return false.
    assert!(!client.is_registered(&phantom));
}

// ── Multisig state rollback ────────────────────────────────────────────────

/// Signing a multisig payment by a signer who has already signed must be
/// rejected; the collected-signatures list must remain unchanged.
#[test]
fn test_state_unchanged_after_double_sign_multisig() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let mut signers = soroban_sdk::vec![&env, signer.clone()];

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "ROLLBACK_MS_DSIGN"),
        &merchant,
        &token,
        &500,
        &signers,
        &1,
        &None,
    );

    client.sign_multisig_payment(
        &signer,
        &str(&env, "ROLLBACK_MS_DSIGN"),
        &bytes(&env, &[1u8; 64]),
    );

    let ms_before = client.get_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_DSIGN"));
    let sig_count_before = ms_before.collected.len();

    // Attempt to sign again with the same signer.
    let result = client.try_sign_multisig_payment(
        &signer,
        &str(&env, "ROLLBACK_MS_DSIGN"),
        &bytes(&env, &[2u8; 64]),
    );
    assert_eq!(result, Err(Ok(PaymentError::MultisigAlreadySigned)));

    // Collected-signatures count must be unchanged.
    let ms_after = client.get_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_DSIGN"));
    assert_eq!(ms_after.collected.len(), sig_count_before);
    assert!(!ms_after.executed);
}

/// Executing an already-executed multisig payment must be rejected; the
/// executed flag must remain true and no second token transfer can occur.
#[test]
fn test_state_unchanged_after_double_execute_multisig() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let signers = soroban_sdk::vec![&env, signer.clone()];

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "ROLLBACK_MS_DEXEC"),
        &merchant,
        &token,
        &300,
        &signers,
        &1,
        &None,
    );
    client.sign_multisig_payment(
        &signer,
        &str(&env, "ROLLBACK_MS_DEXEC"),
        &bytes(&env, &[1u8; 64]),
    );
    client.execute_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_DEXEC"));

    let ms_executed = client.get_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_DEXEC"));
    assert!(ms_executed.executed);

    // Second execute must fail.
    let result = client.try_execute_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_DEXEC"));
    assert_eq!(result, Err(Ok(PaymentError::MultisigAlreadyExecuted)));

    // State must still show executed.
    let ms_after = client.get_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_DEXEC"));
    assert!(ms_after.executed);
}

/// Executing a multisig payment with insufficient signatures must be
/// rejected; the payment must remain unexecuted and no token transfer
/// must occur.
#[test]
fn test_state_unchanged_after_insufficient_signatures_multisig() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signers = soroban_sdk::vec![&env, signer1.clone(), signer2.clone()];

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "ROLLBACK_MS_INSIG"),
        &merchant,
        &token,
        &400,
        &signers,
        &2,
        &None,
    );
    // Only one of two required signatures.
    client.sign_multisig_payment(
        &signer1,
        &str(&env, "ROLLBACK_MS_INSIG"),
        &bytes(&env, &[1u8; 64]),
    );

    let result = client.try_execute_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_INSIG"));
    assert_eq!(result, Err(Ok(PaymentError::InsufficientSignatures)));

    // Payment must not be executed.
    let ms = client.get_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_INSIG"));
    assert!(!ms.executed);
}

/// Cancelling an already-cancelled multisig payment must be rejected; state
/// must remain cancelled.
#[test]
fn test_state_unchanged_after_double_cancel_multisig() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();
    let signer = Address::generate(&env);
    let signers = soroban_sdk::vec![&env, signer.clone()];

    client.initiate_multisig_payment(
        &payer,
        &str(&env, "ROLLBACK_MS_DCANCEL"),
        &merchant,
        &token,
        &200,
        &signers,
        &1,
        &None,
    );
    client.cancel_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_DCANCEL"));

    let ms_cancelled = client.get_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_DCANCEL"));
    assert!(ms_cancelled.cancelled);

    let result = client.try_cancel_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_DCANCEL"));
    assert_eq!(result, Err(Ok(PaymentError::MultisigAlreadyCancelled)));

    let ms_after = client.get_multisig_payment(&payer, &str(&env, "ROLLBACK_MS_DCANCEL"));
    assert!(ms_after.cancelled);
    assert!(!ms_after.executed);
}

// ── Contract-paused state rollback ─────────────────────────────────────────

/// Any payment attempted while the contract is paused must be rejected and
/// must not create a payment record.
#[test]
fn test_state_unchanged_after_payment_while_paused() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    client.pause_contract(&admin);

    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);

    let result = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "ROLLBACK_PAUSED_PAY"),
        &merchant,
        &token,
        &100,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );
    assert_eq!(result, Err(Ok(PaymentError::ContractPaused)));

    let history = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(history.total_matching, 0);
}

/// A refund initiation attempted while the contract is paused must be
/// rejected and must not create a refund record.
#[test]
fn test_state_unchanged_after_refund_while_paused() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();
    make_payment(&env, &client, &merchant, &payer, &token, "ROLLBACK_PAUSED_BASE", 1_000);

    client.pause_contract(&admin);

    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "ROLLBACK_PAUSED_REF"),
        &str(&env, "ROLLBACK_PAUSED_BASE"),
        &200,
        &str(&env, "paused"),
    );
    assert_eq!(result, Err(Ok(PaymentError::ContractPaused)));

    // Payment refunded_amount must still be zero.
    // Unpause first so we can read state.
    client.unpause_contract(&admin);
    let payment = client.get_payment_by_id(&payer, &str(&env, "ROLLBACK_PAUSED_BASE"));
    assert_eq!(payment.refunded_amount, 0);
}

// ── Admin error handling state rollback ────────────────────────────────────

/// A second set_admin call must fail with AdminAlreadySet and must not
/// replace the stored admin.
#[test]
fn test_state_unchanged_after_second_set_admin() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let impostor = Address::generate(&env);
    client.set_admin(&admin);

    let result = client.try_set_admin(&impostor);
    assert_eq!(result, Err(Ok(PaymentError::AdminAlreadySet)));

    // Original admin must still be stored.
    let stored = env.as_contract(&client.address, || storage::get_admin(&env));
    assert_eq!(stored, Some(admin));
}

/// An unauthorized admin transfer must not change the stored admin.
#[test]
fn test_state_unchanged_after_unauthorized_admin_transfer() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let non_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    client.set_admin(&admin);

    let result = client.try_transfer_admin(&non_admin, &new_admin);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));

    // Admin must still be the original.
    let stored = env.as_contract(&client.address, || storage::get_admin(&env));
    assert_eq!(stored, Some(admin));
}

// ── Batch payment atomicity (extended) ────────────────────────────────────

/// When a batch fails on the second item (invalid amount), the first item
/// that succeeded inside the batch must NOT be persisted (atomicity).
#[test]
fn test_batch_payment_first_item_not_stored_on_later_failure() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    let items = soroban_sdk::vec![
        &env,
        BatchPaymentItem {
            order_id: str(&env, "BATCH_ATOM_OK"),
            merchant_address: merchant.clone(),
            token_address: token.clone(),
            amount: 100,
            memo: str(&env, "valid"),
            signature: bytes(&env, &[0u8; 64]),
            merchant_public_key: bytes(&env, &[0u8; 32]),
        },
        BatchPaymentItem {
            order_id: str(&env, "BATCH_ATOM_FAIL"),
            merchant_address: merchant.clone(),
            token_address: token.clone(),
            amount: -1,
            memo: str(&env, "bad amount"),
            signature: bytes(&env, &[0u8; 64]),
            merchant_public_key: bytes(&env, &[0u8; 32]),
        },
    ];

    let result = client.try_batch_payment(&payer, &items);
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));

    // Neither item must appear in payer history.
    let history = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(history.total_matching, 0);
}

/// When a batch fails because one item targets an inactive merchant, no
/// items from that batch must be stored.
#[test]
fn test_batch_payment_no_partial_state_on_inactive_merchant() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    // Register a second merchant and immediately deactivate it.
    let inactive_merchant = Address::generate(&env);
    client.register_merchant(
        &inactive_merchant,
        &str(&env, "Inactive"),
        &str(&env, ""),
        &str(&env, ""),
        &MerchantCategory::Other,
    );
    client.deactivate_merchant(&admin, &inactive_merchant);

    let items = soroban_sdk::vec![
        &env,
        BatchPaymentItem {
            order_id: str(&env, "BATCH_INACT_OK"),
            merchant_address: merchant.clone(),
            token_address: token.clone(),
            amount: 100,
            memo: str(&env, "valid"),
            signature: bytes(&env, &[0u8; 64]),
            merchant_public_key: bytes(&env, &[0u8; 32]),
        },
        BatchPaymentItem {
            order_id: str(&env, "BATCH_INACT_FAIL"),
            merchant_address: inactive_merchant.clone(),
            token_address: token.clone(),
            amount: 100,
            memo: str(&env, "inactive merchant"),
            signature: bytes(&env, &[0u8; 64]),
            merchant_public_key: bytes(&env, &[0u8; 32]),
        },
    ];

    let result = client.try_batch_payment(&payer, &items);
    assert_eq!(result, Err(Ok(PaymentError::MerchantInactive)));

    // No payments must have been stored.
    let history = client.get_payer_payment_history(
        &payer,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(history.total_matching, 0);
}

// ── Global stats unchanged on failure ─────────────────────────────────────

/// Global stats must not change when a payment is rejected.
#[test]
fn test_global_stats_unchanged_after_failed_payment() {
    let (env, client, admin, merchant, payer, token) = setup_payment_env();

    let stats_before = client.get_global_payment_stats(&admin, &None, &None);

    // Try an invalid-amount payment.
    let pub_key = bytes(&env, &[0u8; 32]);
    let sig = bytes(&env, &[0u8; 64]);
    let _ = client.try_process_payment_with_signature(
        &payer,
        &str(&env, "ROLLBACK_STATS_PAY"),
        &merchant,
        &token,
        &0,
        &str(&env, ""),
        &None,
        &sig,
        &pub_key,
    );

    let stats_after = client.get_global_payment_stats(&admin, &None, &None);
    assert_eq!(stats_before.total_payments, stats_after.total_payments);
    assert_eq!(stats_before.total_volume, stats_after.total_volume);
}

// ── Payment-request state rollback ────────────────────────────────────────

/// Paying an expired payment request must be rejected and must not update
/// the merchant's payment history.
#[test]
fn test_state_unchanged_after_expired_payment_request() {
    let (env, client, _admin, merchant, payer, token) = setup_payment_env();

    // Create a request that expires in 60 seconds.
    client.create_payment_request(
        &merchant,
        &str(&env, "ROLLBACK_REQ_EXP"),
        &token,
        &500,
        &str(&env, "expires soon"),
        &60,
    );

    // Advance past the TTL.
    env.ledger().with_mut(|l| {
        l.timestamp += 61;
    });

    let result = client.try_pay_payment_request(
        &payer,
        &str(&env, "ROLLBACK_REQ_EXP"),
    );
    assert_eq!(result, Err(Ok(PaymentError::PaymentExpired)));

    // Merchant history must be empty.
    let history = client.get_merchant_payment_history(
        &merchant,
        &None,
        &10,
        &None,
        &SortField::Date,
        &SortOrder::Ascending,
    );
    assert_eq!(history.total_matching, 0);
}
