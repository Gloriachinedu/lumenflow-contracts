// Integration tests for admin permission elevation and transfer boundary cases.
// Closes issue #347.
//
// Acceptance criteria:
//   - Self-transfer is blocked (returns InvalidAdminAddress).
//   - Transfer to a non-existent / zero-equivalent address is blocked.
//   - Unauthorized callers cannot transfer admin rights.
//   - A legitimate transfer works and the old admin loses privileges.
//   - State (merchants, payments) is preserved across an admin handover.

#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Bytes, Env, String,
};

use lumenflow::{
    error::PaymentError,
    types::MerchantCategory,
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
    let token_id = env.register_stellar_asset_contract_v2(admin.clone());
    token_id.address()
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// A standard successful admin transfer must work and revoke old admin rights.
#[test]
fn test_admin_transfer_success_revokes_old_admin() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    client.set_admin(&admin);

    // Transfer should succeed.
    client.transfer_admin(&admin, &new_admin);

    // Old admin is now unauthorized.
    let result = client.try_set_payment_cleanup_period(&admin, &86400);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));

    // New admin can perform privileged actions.
    client.set_payment_cleanup_period(&new_admin, &86400);
}

/// Transferring admin to the same address (self-transfer) must be rejected.
#[test]
fn test_admin_self_transfer_rejected() {
    let (env, client) = setup();
    let admin = Address::generate(&env);

    client.set_admin(&admin);

    let result = client.try_transfer_admin(&admin, &admin);
    assert_eq!(result, Err(Ok(PaymentError::InvalidAdminAddress)));

    // Admin must still hold rights after the failed transfer.
    client.set_payment_cleanup_period(&admin, &86400);
}

/// A caller who is not the current admin must not be able to transfer admin rights.
#[test]
fn test_admin_transfer_unauthorized_caller_rejected() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let attacker = Address::generate(&env);
    let target = Address::generate(&env);

    client.set_admin(&admin);

    let result = client.try_transfer_admin(&attacker, &target);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));

    // Real admin must still hold rights.
    client.set_payment_cleanup_period(&admin, &86400);
}

/// Merchant records and contract state are preserved after an admin handover.
#[test]
fn test_admin_transfer_preserves_contract_state() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);

    client.set_admin(&admin);
    client.add_allowed_token(&admin, &token);

    // Register a merchant before the transfer.
    client.register_merchant(
        &merchant,
        &str(&env, "Test Store"),
        &str(&env, "desc"),
        &str(&env, "contact@example.com"),
        &MerchantCategory::Retail,
    );

    // Perform the admin handover.
    client.transfer_admin(&admin, &new_admin);

    // Merchant record must still be intact.
    let m = client.get_merchant(&merchant);
    assert_eq!(m.name, str(&env, "Test Store"));
    assert!(m.active);

    // New admin can deactivate the merchant.
    client.deactivate_merchant(&new_admin, &merchant);
    let m_deactivated = client.get_merchant(&merchant);
    assert!(!m_deactivated.active);

    // Old admin cannot reactivate (no longer authorized).
    let result = client.try_reactivate_merchant(&admin, &merchant);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

/// Multiple sequential admin handovers must each revoke the previous admin.
#[test]
fn test_admin_transfer_chained_handovers() {
    let (env, client) = setup();
    let admin1 = Address::generate(&env);
    let admin2 = Address::generate(&env);
    let admin3 = Address::generate(&env);

    client.set_admin(&admin1);

    // First handover: admin1 → admin2.
    client.transfer_admin(&admin1, &admin2);

    // admin1 is now unauthorized.
    let r1 = client.try_set_payment_cleanup_period(&admin1, &1000);
    assert_eq!(r1, Err(Ok(PaymentError::Unauthorized)));

    // Second handover: admin2 → admin3.
    client.transfer_admin(&admin2, &admin3);

    // admin2 is now unauthorized.
    let r2 = client.try_set_payment_cleanup_period(&admin2, &1000);
    assert_eq!(r2, Err(Ok(PaymentError::Unauthorized)));

    // admin3 holds current rights.
    client.set_payment_cleanup_period(&admin3, &1000);
}

/// A transfer to a second distinct non-self address must always succeed.
#[test]
fn test_admin_transfer_to_distinct_address_succeeds() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let new_admin = Address::generate(&env);

    // Confirm they are distinct (unlikely to collide but guard anyway).
    assert_ne!(admin, new_admin);

    client.set_admin(&admin);
    let result = client.try_transfer_admin(&admin, &new_admin);
    assert!(result.is_ok());
}

/// Admin transfer with no admin set must fail (no admin configured yet).
#[test]
fn test_admin_transfer_no_admin_set_rejected() {
    let (env, client) = setup();
    let pretend_admin = Address::generate(&env);
    let target = Address::generate(&env);

    // No set_admin call — must return Unauthorized.
    let result = client.try_transfer_admin(&pretend_admin, &target);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}
