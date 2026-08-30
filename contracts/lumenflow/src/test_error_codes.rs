#![cfg(test)]

extern crate alloc;

use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, String};

use crate::{error::PaymentError, storage, PaymentProcessingContract, PaymentProcessingContractClient};

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

#[test]
fn test_error_unauthorized_is_triggered() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    let result = client.try_set_payment_cleanup_period(&admin, &86400);
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

#[test]
fn test_error_invalid_admin_address_is_triggered() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    let result = client.try_transfer_admin(&admin, &admin);
    assert_eq!(result, Err(Ok(PaymentError::InvalidAdminAddress)));
}

#[test]
fn test_error_invalid_input_is_triggered() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    let result = client.try_set_multisig_expiry_duration(&admin, &0);
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

#[test]
fn test_error_version_mismatch_is_triggered() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    env.as_contract(&client.address, || {
        storage::set_stored_version(&env, &str(&env, "0.0.0"));
    });
    let result = client.try_assert_version_matches(&admin);
    assert_eq!(result, Err(Ok(PaymentError::VersionMismatch)));
}

#[test]
fn test_error_refund_below_minimum_is_triggered() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    client.register_merchant(&merchant, &str(&env, "Demo"), &str(&env, "Demo"), &str(&env, "demo@example.com"), &crate::types::MerchantCategory::Retail);
    let order_id = str(&env, "refund-order");
    let result = client.try_initiate_refund(
        &payer,
        &str(&env, "refund-1"),
        &order_id,
        &1,
        &str(&env, "too small"),
    );
    assert_eq!(result, Err(Ok(PaymentError::RefundBelowMinimum)));
}

#[test]
fn test_error_subscription_interval_not_elapsed_is_triggered() {
    let (env, client) = setup();
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    let merchant = Address::generate(&env);
    let subscriber = Address::generate(&env);
    let plan_id = str(&env, "plan");
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    client.register_merchant(&merchant, &str(&env, "Demo"), &str(&env, "Demo"), &str(&env, "demo@example.com"), &crate::types::MerchantCategory::Retail);
    client.add_allowed_token(&admin, &token);
    client.create_subscription_plan(&admin, &plan_id, &token, &1_000, &60, &1);
    client.subscribe(&merchant, &subscriber, &plan_id, &str(&env, "sub-1"));
    let result = client.try_charge_subscription(&merchant, &str(&env, "sub-1"));
    assert_eq!(result, Err(Ok(PaymentError::SubscriptionIntervalNotElapsed)));
}
