// Security regression tests: admin-only function access control.
//
// Closes issue #1268.
//
// Acceptance criteria (all 12 admin-only functions):
//   - Every admin-only function returns ContractError::Unauthorized when
//     called by a non-admin address.
//
// MARKER: admin_only_functions_reject_non_admin_caller

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Env, String, Vec as SorobanVec,
};

use lumenflow::{
    error::PaymentError, PaymentProcessingContract, PaymentProcessingContractClient,
};
use lumenflow::types::AdminAuditEntry;

// ── Helpers ───────────────────────────────────────────────────────────────────

fn setup_with_admin() -> (Env, PaymentProcessingContractClient<'static>, Address) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    (env, client, admin)
}

fn str(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

/// Returns the current length of the on-chain admin audit log.
fn audit_log_len(client: &PaymentProcessingContractClient) -> u32 {
    client.get_admin_audit_log(&0u32, &100u32).len()
}

/// Asserts that exactly one new audit entry was appended and returns it.
fn assert_one_new_entry(
    client: &PaymentProcessingContractClient,
    before: u32,
) -> AdminAuditEntry {
    let after = audit_log_len(client);
    assert_eq!(
        after,
        before + 1,
        "expected exactly one audit entry to be appended"
    );
    let log = client.get_admin_audit_log(&0u32, &100u32);
    log.get(after - 1).expect("audit entry must exist")
}

// ── Regression tests: admin_only_functions_reject_non_admin_caller ────────────

/// VDR-015: transfer_admin must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_transfer_admin() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let before = audit_log_len(&client);
    let result = client.try_transfer_admin(&non_admin, &new_admin);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "transfer_admin must return Unauthorized for non-admin caller"
    );
    assert_eq!(
        audit_log_len(&client),
        before,
        "rejected transfer_admin must not append an audit entry"
    );
}

/// transfer_admin by the admin must append an audit entry.
#[test]
fn test_transfer_admin_appends_audit_entry() {
    let (env, client, admin) = setup_with_admin();
    let new_admin = Address::generate(&env);

    let before = audit_log_len(&client);
    client.transfer_admin(&admin, &new_admin);
    let entry = assert_one_new_entry(&client, before);
    assert_eq!(entry.actor, admin);
}

/// VDR-016: set_platform_fee must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_set_platform_fee() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);
    let fee_recipient = Address::generate(&env);

    let result = client.try_set_platform_fee(&non_admin, &100u32, &fee_recipient);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "set_platform_fee must return Unauthorized for non-admin caller"
    );
}

/// VDR-017: pause_contract must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_pause_contract() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);

    let before = audit_log_len(&client);
    let result = client.try_pause_contract(&non_admin);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "pause_contract must return Unauthorized for non-admin caller"
    );
    assert_eq!(
        audit_log_len(&client),
        before,
        "rejected pause_contract must not append an audit entry"
    );
}

/// pause_contract by the admin must append an audit entry.
#[test]
fn test_pause_contract_appends_audit_entry() {
    let (env, client, admin) = setup_with_admin();

    let before = audit_log_len(&client);
    client.pause_contract(&admin);
    let entry = assert_one_new_entry(&client, before);
    assert_eq!(entry.actor, admin);
}

/// VDR-018: unpause_contract must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_unpause_contract() {
    let (env, client, admin) = setup_with_admin();
    let non_admin = Address::generate(&env);

    // First pause so we can attempt unpause.
    client.pause_contract(&admin);

    let before = audit_log_len(&client);
    let result = client.try_unpause_contract(&non_admin);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "unpause_contract must return Unauthorized for non-admin caller"
    );
    assert_eq!(
        audit_log_len(&client),
        before,
        "rejected unpause_contract must not append an audit entry"
    );
}

/// unpause_contract by the admin must append an audit entry.
#[test]
fn test_unpause_contract_appends_audit_entry() {
    let (env, client, admin) = setup_with_admin();

    client.pause_contract(&admin);

    let before = audit_log_len(&client);
    client.unpause_contract(&admin);
    let entry = assert_one_new_entry(&client, before);
    assert_eq!(entry.actor, admin);
}

/// VDR-019: pause_with_reason must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_pause_with_reason() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);

    let before = audit_log_len(&client);
    let result = client.try_pause_with_reason(&non_admin, &str(&env, "maintenance"));
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "pause_with_reason must return Unauthorized for non-admin caller"
    );
    assert_eq!(
        audit_log_len(&client),
        before,
        "rejected pause_with_reason must not append an audit entry"
    );
}

/// pause_with_reason by the admin must append an audit entry.
#[test]
fn test_pause_with_reason_appends_audit_entry() {
    let (env, client, admin) = setup_with_admin();

    let before = audit_log_len(&client);
    client.pause_with_reason(&admin, &str(&env, "maintenance"));
    let entry = assert_one_new_entry(&client, before);
    assert_eq!(entry.actor, admin);
}

/// VDR-020: set_pause_guardians must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_set_pause_guardians() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);
    let mut guardians = SorobanVec::new(&env);
    for _ in 0..5 {
        guardians.push_back(Address::generate(&env));
    }

    let result = client.try_set_pause_guardians(&non_admin, &guardians);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "set_pause_guardians must return Unauthorized for non-admin caller"
    );
}

/// VDR-021: set_rate_limit must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_set_rate_limit() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);

    let result = client.try_set_rate_limit(&non_admin, &10u32);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "set_rate_limit must return Unauthorized for non-admin caller"
    );
}

/// VDR-022: set_large_payment_threshold must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_set_large_payment_threshold() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);

    let result = client.try_set_large_payment_threshold(&non_admin, &1_000_000i128);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "set_large_payment_threshold must return Unauthorized for non-admin caller"
    );
}

/// VDR-023: add_allowed_token must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_add_allowed_token() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_id.address();

    let before = audit_log_len(&client);
    let result = client.try_add_allowed_token(&non_admin, &token, &None);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "add_allowed_token must return Unauthorized for non-admin caller"
    );
    assert_eq!(
        audit_log_len(&client),
        before,
        "rejected add_allowed_token must not append an audit entry"
    );
}

/// add_allowed_token by the admin must append an audit entry.
#[test]
fn test_add_allowed_token_appends_audit_entry() {
    let (env, client, admin) = setup_with_admin();
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_id.address();

    let before = audit_log_len(&client);
    client.add_allowed_token(&admin, &token, &None);
    let entry = assert_one_new_entry(&client, before);
    assert_eq!(entry.actor, admin);
}

/// VDR-024: remove_allowed_token must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_remove_allowed_token() {
    let (env, client, admin) = setup_with_admin();
    let non_admin = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_id.address();

    // First add the token with admin so we can try removing it.
    client.add_allowed_token(&admin, &token, &None);

    let before = audit_log_len(&client);
    let result = client.try_remove_allowed_token(&non_admin, &token);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "remove_allowed_token must return Unauthorized for non-admin caller"
    );
    assert_eq!(
        audit_log_len(&client),
        before,
        "rejected remove_allowed_token must not append an audit entry"
    );
}

/// remove_allowed_token by the admin must append an audit entry.
#[test]
fn test_remove_allowed_token_appends_audit_entry() {
    let (env, client, admin) = setup_with_admin();
    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_id.address();

    client.add_allowed_token(&admin, &token, &None);

    let before = audit_log_len(&client);
    client.remove_allowed_token(&admin, &token);
    let entry = assert_one_new_entry(&client, before);
    assert_eq!(entry.actor, admin);
}

/// VDR-025: cleanup_expired_refunds must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_cleanup_expired_refunds() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);

    let result = client.try_cleanup_expired_refunds(&non_admin);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "cleanup_expired_refunds must return Unauthorized for non-admin caller"
    );
}

/// VDR-026: cancel_expired_payment_requests must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_cancel_expired_payment_requests() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);

    let before = audit_log_len(&client);
    let result = client.try_cancel_expired_payment_requests(&non_admin);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "cancel_expired_payment_requests must return Unauthorized for non-admin caller"
    );
    assert_eq!(
        audit_log_len(&client),
        before,
        "rejected cancel_expired_payment_requests must not append an audit entry"
    );
}

/// cancel_expired_payment_requests by the admin must append an audit entry.
#[test]
fn test_cancel_expired_payment_requests_appends_audit_entry() {
    let (env, client, admin) = setup_with_admin();

    let before = audit_log_len(&client);
    client.cancel_expired_payment_requests(&admin);
    let entry = assert_one_new_entry(&client, before);
    assert_eq!(entry.actor, admin);
}

// ── Audit log: merchant suspension and emergency withdrawal ───────────────────

/// suspend_merchant by the admin must append an audit entry.
#[test]
fn test_suspend_merchant_appends_audit_entry() {
    let (env, client, admin) = setup_with_admin();
    let merchant = Address::generate(&env);

    let before = audit_log_len(&client);
    client.suspend_merchant(&admin, &merchant);
    let entry = assert_one_new_entry(&client, before);
    assert_eq!(entry.actor, admin);
}

/// unsuspend_merchant by the admin must append an audit entry.
#[test]
fn test_unsuspend_merchant_appends_audit_entry() {
    let (env, client, admin) = setup_with_admin();
    let merchant = Address::generate(&env);

    client.suspend_merchant(&admin, &merchant);

    let before = audit_log_len(&client);
    client.unsuspend_merchant(&admin, &merchant);
    let entry = assert_one_new_entry(&client, before);
    assert_eq!(entry.actor, admin);
}

/// emergency_withdraw by the admin must append an audit entry.
#[test]
fn test_emergency_withdraw_appends_audit_entry() {
    let (env, client, admin) = setup_with_admin();
    let recipient = Address::generate(&env);

    let before = audit_log_len(&client);
    client.emergency_withdraw(&admin, &recipient);
    let entry = assert_one_new_entry(&client, before);
    assert_eq!(entry.actor, admin);
}

/// Non-admin callers of merchant suspension and emergency withdrawal are
/// rejected before any audit entry is written.
#[test]
fn test_non_admin_sensitive_ops_do_not_append_audit_entries() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let recipient = Address::generate(&env);

    let before = audit_log_len(&client);

    assert_eq!(
        client.try_suspend_merchant(&non_admin, &merchant),
        Err(Ok(PaymentError::Unauthorized)),
        "suspend_merchant must return Unauthorized for non-admin caller"
    );
    assert_eq!(
        client.try_unsuspend_merchant(&non_admin, &merchant),
        Err(Ok(PaymentError::Unauthorized)),
        "unsuspend_merchant must return Unauthorized for non-admin caller"
    );
    assert_eq!(
        client.try_emergency_withdraw(&non_admin, &recipient),
        Err(Ok(PaymentError::Unauthorized)),
        "emergency_withdraw must return Unauthorized for non-admin caller"
    );

    assert_eq!(
        audit_log_len(&client),
        before,
        "rejected admin operations must not append audit entries"
    );
}

// ── Audit log: append-only and pagination guarantees ──────────────────────────

/// The audit log is append-only: earlier entries are never overwritten and
/// pagination returns stable, non-overlapping slices.
#[test]
fn test_admin_audit_log_is_append_only_and_paginated() {
    let (env, client, admin) = setup_with_admin();

    client.pause_contract(&admin);
    client.unpause_contract(&admin);
    client.pause_with_reason(&admin, &str(&env, "maintenance"));

    let total = audit_log_len(&client);
    assert_eq!(total, 3, "each admin action must append exactly one entry");

    let full = client.get_admin_audit_log(&0u32, &100u32);
    assert_eq!(full.len(), total);

    // Pagination: first page and second page must not overlap and must
    // reproduce the full log in order.
    let first_page = client.get_admin_audit_log(&0u32, &2u32);
    let second_page = client.get_admin_audit_log(&2u32, &2u32);
    assert_eq!(first_page.len(), 2);
    assert_eq!(second_page.len(), 1);
    assert_eq!(first_page.get(0).unwrap(), full.get(0).unwrap());
    assert_eq!(first_page.get(1).unwrap(), full.get(1).unwrap());
    assert_eq!(second_page.get(0).unwrap(), full.get(2).unwrap());

    // Appending a new action must not mutate previously recorded entries.
    client.pause_contract(&admin);
    let after = client.get_admin_audit_log(&0u32, &100u32);
    assert_eq!(after.len(), total + 1);
    for i in 0..total {
        assert_eq!(
            after.get(i).unwrap(),
            full.get(i).unwrap(),
            "existing audit entries must be immutable"
        );
    }
}
