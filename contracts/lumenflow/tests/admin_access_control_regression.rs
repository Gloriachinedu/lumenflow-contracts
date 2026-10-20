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

// ── Regression tests: admin_only_functions_reject_non_admin_caller ────────────

/// VDR-015: transfer_admin must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_transfer_admin() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    let result = client.try_transfer_admin(&non_admin, &new_admin);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "transfer_admin must return Unauthorized for non-admin caller"
    );
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

    let result = client.try_pause_contract(&non_admin);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "pause_contract must return Unauthorized for non-admin caller"
    );
}

/// VDR-018: unpause_contract must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_unpause_contract() {
    let (env, client, admin) = setup_with_admin();
    let non_admin = Address::generate(&env);

    // First pause so we can attempt unpause.
    client.pause_contract(&admin);

    let result = client.try_unpause_contract(&non_admin);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "unpause_contract must return Unauthorized for non-admin caller"
    );
}

/// VDR-019: pause_with_reason must reject a non-admin caller.
#[test]
fn test_non_admin_cannot_call_pause_with_reason() {
    let (env, client, _admin) = setup_with_admin();
    let non_admin = Address::generate(&env);

    let result = client.try_pause_with_reason(&non_admin, &str(&env, "maintenance"));
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "pause_with_reason must return Unauthorized for non-admin caller"
    );
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

    let result = client.try_add_allowed_token(&non_admin, &token, &None);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "add_allowed_token must return Unauthorized for non-admin caller"
    );
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

    let result = client.try_remove_allowed_token(&non_admin, &token);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "remove_allowed_token must return Unauthorized for non-admin caller"
    );
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

    let result = client.try_cancel_expired_payment_requests(&non_admin);
    assert_eq!(
        result,
        Err(Ok(PaymentError::Unauthorized)),
        "cancel_expired_payment_requests must return Unauthorized for non-admin caller"
    );
}
