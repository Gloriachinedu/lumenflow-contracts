/// Integration tests for the LumenFlow router contract.
///
/// These tests cover the core routing decision paths described in issue #1031:
///   - routing to an active merchant succeeds
///   - routing to an inactive merchant returns MerchantNotActive
///   - routing to an unregistered address returns MerchantNotFound
///   - router correctly passes token and amount to the lumenflow contract
extern crate alloc;

use soroban_sdk::{
    testutils::Address as _,
    Address, Env, String,
};

use lumenflow::{MerchantCategory, PaymentProcessingContract, PaymentProcessingContractClient};
use lumenflow_router::{RouterContract, RouterContractClient, RouterError};

// ── Test helpers ──────────────────────────────────────────────────────────────

/// Set up a fresh environment with both the lumenflow and router contracts deployed.
/// Returns (env, router_client, lumenflow_client, admin, active_merchant, inactive_merchant, token).
fn setup_router_env() -> (
    Env,
    RouterContractClient<'static>,
    PaymentProcessingContractClient<'static>,
    Address,
    Address,
    Address,
    Address,
) {
    let env = Env::default();
    env.mock_all_auths();

    // Deploy lumenflow contract
    let lumenflow_id = env.register(PaymentProcessingContract, ());
    let lumenflow_client = PaymentProcessingContractClient::new(&env, &lumenflow_id);

    // Deploy router contract
    let router_id = env.register(RouterContract, ());
    let router_client = RouterContractClient::new(&env, &router_id);

    let admin = Address::generate(&env);
    let active_merchant = Address::generate(&env);
    let inactive_merchant = Address::generate(&env);

    // Create a test token
    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone()).address();

    // Initialise lumenflow
    lumenflow_client.set_admin(&admin);
    lumenflow_client.add_allowed_token(&admin, &token);

    // Register active merchant
    lumenflow_client.register_merchant(
        &active_merchant,
        &String::from_str(&env, "Active Store"),
        &String::from_str(&env, "An active merchant"),
        &String::from_str(&env, "active@store.com"),
        &MerchantCategory::Retail,
    );

    // Register inactive merchant and then deactivate
    lumenflow_client.register_merchant(
        &inactive_merchant,
        &String::from_str(&env, "Inactive Store"),
        &String::from_str(&env, "A deactivated merchant"),
        &String::from_str(&env, "inactive@store.com"),
        &MerchantCategory::Retail,
    );
    lumenflow_client.deactivate_merchant(&admin, &inactive_merchant);

    // Wire router to lumenflow
    router_client.set_lumenflow_contract(&lumenflow_id);

    (
        env,
        router_client,
        lumenflow_client,
        admin,
        active_merchant,
        inactive_merchant,
        token,
    )
}

// ── Tests ─────────────────────────────────────────────────────────────────────

/// AC1: Integration test — route to active merchant succeeds.
///
/// Verifies that `route_payment` returns a valid `RouteResult` when the target
/// merchant is registered and active in the lumenflow contract.
#[test]
fn test_route_to_active_merchant_succeeds() {
    let (env, router, _lumenflow, _admin, active_merchant, _inactive, token) =
        setup_router_env();

    let result = router.route_payment(&active_merchant, &token, &1_000_i128);

    assert_eq!(result.merchant, active_merchant);
    assert_eq!(result.token, token);
    assert_eq!(result.amount, 1_000_i128);
}

/// AC2: Integration test — route to inactive merchant returns MerchantNotActive.
///
/// Verifies that `route_payment` returns [`RouterError::MerchantNotActive`] when
/// the target merchant exists but has been deactivated.
#[test]
fn test_route_to_inactive_merchant_returns_merchant_not_active() {
    let (env, router, _lumenflow, _admin, _active, inactive_merchant, token) =
        setup_router_env();

    let result = router.try_route_payment(&inactive_merchant, &token, &500_i128);
    assert_eq!(result, Err(Ok(RouterError::MerchantNotActive)));
}

/// AC3: Integration test — route to unregistered address returns MerchantNotFound.
///
/// Verifies that `route_payment` returns [`RouterError::MerchantNotFound`] when
/// the target address has never been registered as a merchant.
#[test]
fn test_route_to_unregistered_merchant_returns_merchant_not_found() {
    let (env, router, _lumenflow, _admin, _active, _inactive, token) = setup_router_env();

    let unknown = Address::generate(&env);
    let result = router.try_route_payment(&unknown, &token, &500_i128);
    assert_eq!(result, Err(Ok(RouterError::MerchantNotFound)));
}

/// AC4: Integration test — router correctly passes token and amount to lumenflow contract.
///
/// Verifies that the `RouteResult` returned by `route_payment` preserves the
/// exact token address and amount provided by the caller, ensuring the router
/// does not mutate or drop payment parameters before forwarding them.
#[test]
fn test_router_passes_token_and_amount_correctly() {
    let (env, router, _lumenflow, _admin, active_merchant, _inactive, token) =
        setup_router_env();

    let expected_amount: i128 = 42_500;
    let result = router.route_payment(&active_merchant, &token, &expected_amount);

    assert_eq!(result.token, token, "router must preserve the token address");
    assert_eq!(result.amount, expected_amount, "router must preserve the amount");
    assert_eq!(result.merchant, active_merchant, "router must preserve the merchant address");
}

/// Extra: route with zero amount returns InvalidAmount error.
#[test]
fn test_route_with_zero_amount_returns_invalid_amount() {
    let (env, router, _lumenflow, _admin, active_merchant, _inactive, token) =
        setup_router_env();

    let result = router.try_route_payment(&active_merchant, &token, &0_i128);
    assert_eq!(result, Err(Ok(RouterError::InvalidAmount)));
}

/// Extra: route with negative amount returns InvalidAmount error.
#[test]
fn test_route_with_negative_amount_returns_invalid_amount() {
    let (env, router, _lumenflow, _admin, active_merchant, _inactive, token) =
        setup_router_env();

    let result = router.try_route_payment(&active_merchant, &token, &(-100_i128));
    assert_eq!(result, Err(Ok(RouterError::InvalidAmount)));
}

/// Extra: merchant reactivated after deactivation can be routed to again.
#[test]
fn test_route_to_reactivated_merchant_succeeds() {
    let (env, router, lumenflow, admin, _active, inactive_merchant, token) =
        setup_router_env();

    // Confirm inactive at first
    let before = router.try_route_payment(&inactive_merchant, &token, &100_i128);
    assert_eq!(before, Err(Ok(RouterError::MerchantNotActive)));

    // Admin reactivates merchant
    lumenflow.reactivate_merchant(&admin, &inactive_merchant);

    // Now routing should succeed
    let result = router.route_payment(&inactive_merchant, &token, &100_i128);
    assert_eq!(result.merchant, inactive_merchant);
    assert_eq!(result.amount, 100_i128);
}
