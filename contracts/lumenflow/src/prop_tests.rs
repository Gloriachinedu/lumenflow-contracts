//! Property-based fuzz tests for payment amount edge cases (Issue #616).
//!
//! These tests use the `proptest` crate to automatically generate random inputs
//! covering the full i128 range, zero amounts, boundary values, and overflow
//! conditions.  They complement fixed-value unit tests by discovering edge cases
//! that hand-written tests would miss.
//!
//! # Running
//!
//! Default (256 iterations per property, fast in CI):
//! ```bash
//! cargo test --package lumenflow --all-features prop_
//! ```
//!
//! Extended local session (100 000 iterations):
//! ```bash
//! PROPTEST_CASES=100000 cargo test --package lumenflow --all-features prop_
//! ```
//!
//! See `docs/testing-guide.md` for a full guide on running fuzz sessions.

#![cfg(test)]

use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Bytes, Env, String as SorobanString, Vec,
};

use crate::{
    error::PaymentError,
    types::MerchantCategory,
    PaymentProcessingContract, PaymentProcessingContractClient,
};

// ── Shared setup ─────────────────────────────────────────────────────────────

struct FuzzFixture {
    env: Env,
    client: PaymentProcessingContractClient<'static>,
    merchant: Address,
    payer: Address,
    token: Address,
}

fn setup_fuzz() -> FuzzFixture {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register(PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(token_admin.clone()).address();

    client.set_admin(&admin);
    client.register_merchant(
        &merchant,
        &SorobanString::from_str(&env, "FuzzStore"),
        &SorobanString::from_str(&env, ""),
        &SorobanString::from_str(&env, ""),
        &MerchantCategory::Retail,
    );

    // Mint maximum possible tokens to payer so balance never limits the test
    StellarAssetClient::new(&env, &token).mint(&payer, &i128::MAX);

    FuzzFixture { env, client, merchant, payer, token }
}

fn dummy_pub_key(env: &Env) -> Bytes {
    Bytes::from_slice(env, &[0u8; 32])
}

fn dummy_sig(env: &Env) -> Bytes {
    Bytes::from_slice(env, &[0u8; 64])
}

// ── Strategies ────────────────────────────────────────────────────────────────

/// Generates any i128 value in [-1, i128::MAX] — the full amount input space.
fn any_i128_amount() -> impl Strategy<Value = i128> {
    prop_oneof![
        // Boundary values
        Just(i128::MAX),
        Just(i128::MAX - 1),
        Just(1i128),
        Just(0i128),
        Just(-1i128),
        Just(i128::MIN),
        Just(i128::MIN + 1),
        // Power-of-two boundaries
        Just(1i128 << 63),
        Just((1i128 << 63) - 1),
        Just(1i128 << 64),
        // Small random values
        (1i128..=1_000_000i128),
        // Large random values
        (1_000_000i128..=i128::MAX),
        // Negative random values
        (i128::MIN..=-1i128),
    ]
}

/// Generates valid positive amounts (1..=i128::MAX).
fn positive_amount() -> impl Strategy<Value = i128> {
    prop_oneof![
        Just(1i128),
        Just(i128::MAX),
        Just(i128::MAX - 1),
        Just(1_000i128),
        (1i128..=i128::MAX),
    ]
}

/// Generates invalid (non-positive) amounts (i128::MIN..=0).
fn non_positive_amount() -> impl Strategy<Value = i128> {
    prop_oneof![
        Just(0i128),
        Just(-1i128),
        Just(i128::MIN),
        (i128::MIN..=0i128),
    ]
}

/// Generates order ID strings of 1–32 ASCII characters.
fn order_id_string() -> impl Strategy<Value = std::string::String> {
    "[A-Z0-9_]{1,32}".prop_filter("must not be empty", |s| !s.is_empty())
}

// ── Property tests ────────────────────────────────────────────────────────────

proptest! {
    /// P1: Any strictly positive amount in [1, i128::MAX] must be accepted.
    ///
    /// This property ensures there is no hidden upper bound below i128::MAX
    /// and no off-by-one at common boundaries.
    #[test]
    fn prop_positive_amount_always_accepted(amount in positive_amount()) {
        let f = setup_fuzz();
        let order_id = SorobanString::from_str(&f.env, "FUZZ_POS");

        let result = f.client.try_process_payment_with_signature(
            &f.payer,
            &order_id,
            &f.merchant,
            &f.token,
            &amount,
            &SorobanString::from_str(&f.env, ""),
            &None,
            &dummy_sig(&f.env),
            &dummy_pub_key(&f.env),
        );

        prop_assert!(
            result.is_ok(),
            "Expected Ok for positive amount {amount}, got: {result:?}"
        );
    }

    /// P2: Any amount ≤ 0 must be rejected with InvalidAmount.
    ///
    /// This covers zero, -1, and i128::MIN.
    #[test]
    fn prop_non_positive_amount_always_rejected(amount in non_positive_amount()) {
        let f = setup_fuzz();
        let order_id = SorobanString::from_str(&f.env, "FUZZ_NEG");

        let result = f.client.try_process_payment_with_signature(
            &f.payer,
            &order_id,
            &f.merchant,
            &f.token,
            &amount,
            &SorobanString::from_str(&f.env, ""),
            &None,
            &dummy_sig(&f.env),
            &dummy_pub_key(&f.env),
        );

        prop_assert_eq!(
            result,
            Err(Ok(PaymentError::InvalidAmount)),
            "Expected InvalidAmount for non-positive amount {amount}"
        );
    }

    /// P3: i128::MAX boundary — the contract must accept the largest possible amount.
    ///
    /// This reproduces the boundary case required by the acceptance criteria.
    /// With the payer minted i128::MAX tokens, this must succeed.
    #[test]
    fn prop_i128_max_boundary_accepted(_dummy in 0u8..1) {
        let f = setup_fuzz();
        let order_id = SorobanString::from_str(&f.env, "FUZZ_MAX");

        let result = f.client.try_process_payment_with_signature(
            &f.payer,
            &order_id,
            &f.merchant,
            &f.token,
            &i128::MAX,
            &SorobanString::from_str(&f.env, ""),
            &None,
            &dummy_sig(&f.env),
            &dummy_pub_key(&f.env),
        );

        prop_assert!(
            result.is_ok(),
            "i128::MAX boundary must be accepted, got: {result:?}"
        );
    }

    /// P4: Duplicate order IDs must always be rejected with PaymentAlreadyExists,
    ///     regardless of the amount used for the second payment.
    #[test]
    fn prop_duplicate_order_id_always_rejected(
        first_amount in positive_amount(),
        second_amount in any_i128_amount(),
    ) {
        let f = setup_fuzz();
        let order_id = SorobanString::from_str(&f.env, "FUZZ_DUP");

        // First payment succeeds
        f.client.process_payment_with_signature(
            &f.payer,
            &order_id,
            &f.merchant,
            &f.token,
            &first_amount,
            &SorobanString::from_str(&f.env, ""),
            &None,
            &dummy_sig(&f.env),
            &dummy_pub_key(&f.env),
        );

        // Second payment with same order_id must fail
        let result = f.client.try_process_payment_with_signature(
            &f.payer,
            &order_id,
            &f.merchant,
            &f.token,
            &second_amount,
            &SorobanString::from_str(&f.env, ""),
            &None,
            &dummy_sig(&f.env),
            &dummy_pub_key(&f.env),
        );

        prop_assert_eq!(
            result,
            Err(Ok(PaymentError::PaymentAlreadyExists)),
            "Duplicate order_id must always be rejected"
        );
    }

    /// P5: Random order IDs of valid length must not cause panics.
    ///
    /// The contract must never panic on any well-formed input; it must always
    /// return either Ok or a typed PaymentError.
    #[test]
    fn prop_no_panic_on_any_order_id(
        order_id_str in order_id_string(),
        amount in any_i128_amount(),
    ) {
        let f = setup_fuzz();
        let order_id = SorobanString::from_str(&f.env, &order_id_str);

        // This must not panic — any result is acceptable
        let result = f.client.try_process_payment_with_signature(
            &f.payer,
            &order_id,
            &f.merchant,
            &f.token,
            &amount,
            &SorobanString::from_str(&f.env, ""),
            &None,
            &dummy_sig(&f.env),
            &dummy_pub_key(&f.env),
        );

        // If amount is positive the only acceptable errors are Ok or a typed error
        // If amount ≤ 0 it must return InvalidAmount
        match amount {
            a if a <= 0 => {
                prop_assert_eq!(
                    result,
                    Err(Ok(PaymentError::InvalidAmount)),
                    "Non-positive amount {amount} must return InvalidAmount"
                );
            }
            _ => {
                // Any result is acceptable (Ok or typed error); must not panic
                prop_assert!(
                    result.is_ok() || matches!(result, Err(Ok(_))),
                    "Must return Ok or typed error for amount {amount}, got: {result:?}"
                );
            }
        }
    }

    /// P6: Refund amount must never exceed original payment amount.
    ///
    /// This property verifies the invariant for any valid payment amount and
    /// any refund amount chosen by the fuzzer.
    #[test]
    fn prop_refund_cannot_exceed_original(
        pay_amount in (1i128..=1_000_000i128),
        refund_amount in (1i128..=2_000_000i128),
    ) {
        let f = setup_fuzz();
        let order_id = SorobanString::from_str(&f.env, "FUZZ_REF");

        f.client.process_payment_with_signature(
            &f.payer,
            &order_id,
            &f.merchant,
            &f.token,
            &pay_amount,
            &SorobanString::from_str(&f.env, ""),
            &None,
            &dummy_sig(&f.env),
            &dummy_pub_key(&f.env),
        );

        let result = f.client.try_initiate_refund(
            &f.payer,
            &SorobanString::from_str(&f.env, "FUZZ_REF_REFUND"),
            &order_id,
            &refund_amount,
            &SorobanString::from_str(&f.env, "fuzz"),
        );

        if refund_amount > pay_amount {
            prop_assert_eq!(
                result,
                Err(Ok(PaymentError::RefundExceedsOriginal)),
                "Refund {refund_amount} > payment {pay_amount} must be rejected"
            );
        } else {
            prop_assert!(
                result.is_ok(),
                "Refund {refund_amount} ≤ payment {pay_amount} must succeed, got: {result:?}"
            );
        }
    }
}

// ── Fixed reproduction tests for fuzzer-discovered edge cases ─────────────────

/// Reproduces the i128::MAX boundary case required by acceptance criteria.
#[test]
fn test_i128_max_boundary_payment() {
    let f = setup_fuzz();
    let order_id = SorobanString::from_str(&f.env, "MAX_BOUNDARY");

    f.client.process_payment_with_signature(
        &f.payer,
        &order_id,
        &f.merchant,
        &f.token,
        &i128::MAX,
        &SorobanString::from_str(&f.env, ""),
        &None,
        &dummy_sig(&f.env),
        &dummy_pub_key(&f.env),
    );

    let payment = f.client.get_payment_by_id(&f.payer, &order_id);
    assert_eq!(payment.amount, i128::MAX);
}

/// Confirms zero amount is rejected.
#[test]
fn test_zero_amount_rejected() {
    let f = setup_fuzz();
    let result = f.client.try_process_payment_with_signature(
        &f.payer,
        &SorobanString::from_str(&f.env, "ZERO"),
        &f.merchant,
        &f.token,
        &0,
        &SorobanString::from_str(&f.env, ""),
        &None,
        &dummy_sig(&f.env),
        &dummy_pub_key(&f.env),
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}

/// Confirms i128::MIN amount is rejected.
#[test]
fn test_i128_min_amount_rejected() {
    let f = setup_fuzz();
    let result = f.client.try_process_payment_with_signature(
        &f.payer,
        &SorobanString::from_str(&f.env, "MIN_BOUND"),
        &f.merchant,
        &f.token,
        &i128::MIN,
        &SorobanString::from_str(&f.env, ""),
        &None,
        &dummy_sig(&f.env),
        &dummy_pub_key(&f.env),
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}
