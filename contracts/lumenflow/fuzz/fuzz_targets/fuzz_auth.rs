//! Fuzz harness for `batch_payment` boundary conditions.
//!
//! This harness is consumed by `cargo-fuzz` (libfuzzer-sys). It drives
//! `batch_payment` with structured arbitrary inputs generated from the raw
//! fuzzer byte stream and asserts that:
//!
//! 1. An empty batch never panics and succeeds (or fails gracefully).
//! 2. A batch of exactly 10 items (the maximum) is accepted.
//! 3. A batch of 11 items is rejected with `BatchSizeExceeded`.
//! 4. A batch containing an invalid item (zero/negative amount, oversized memo,
//!    oversized order_id) is rejected without panicking.
//! 5. No combination of inputs causes undefined behaviour or an unwind panic.
//!
//! ## Running locally
//!
//! ```bash
//! cargo install cargo-fuzz
//! cargo fuzz run fuzz_auth --manifest-path contracts/lumenflow/fuzz/Cargo.toml -- -max_total_time=60
//! ```
//!
//! ## Reproducing a crash
//!
//! ```bash
//! cargo fuzz run fuzz_auth --manifest-path contracts/lumenflow/fuzz/Cargo.toml \
//!     contracts/lumenflow/fuzz/artifacts/fuzz_auth/<crash-file>
//! ```

#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::StellarAssetClient,
    Address, Bytes, Env, String as SorobanString, Vec as SorobanVec,
};

use lumenflow::{
    error::PaymentError,
    types::{BatchPaymentItem, MerchantCategory},
    PaymentProcessingContract, PaymentProcessingContractClient,
};

// ── Fuzzer input layout ───────────────────────────────────────────────────────
//
// byte[0]  : number of items to include (saturated to 0–11)
// byte[1]  : bitmask of which items are "invalid" (bit i → item i invalid)
// byte[2]  : invalid item strategy:
//              0 = zero amount
//              1 = negative amount (−1)
//              2 = oversized order_id (65 chars)
//              3 = oversized memo (257 chars)
//              other = zero amount (default)
// bytes[3..]: ignored (future expansion)

fuzz_target!(|data: &[u8]| {
    if data.is_empty() {
        return;
    }

    let num_items = (data[0] as usize).min(11); // test 0..=11 (11 exceeds limit)
    let invalid_mask: u8 = if data.len() > 1 { data[1] } else { 0 };
    let invalid_strategy: u8 = if data.len() > 2 { data[2] % 4 } else { 0 };

    // ── Set up the Soroban test environment ───────────────────────────────────

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
    client.add_allowed_token(&admin, &token);
    client.register_merchant(
        &merchant,
        &SorobanString::from_str(&env, "Fuzz Merchant"),
        &SorobanString::from_str(&env, ""),
        &SorobanString::from_str(&env, ""),
        &MerchantCategory::Retail,
    );

    // Fund payer with enough tokens for all items
    StellarAssetClient::new(&env, &token).mint(&payer, &1_000_000_000);

    // ── Build the batch ───────────────────────────────────────────────────────

    let pub_key = Bytes::from_slice(&env, &[0u8; 32]);
    let sig = Bytes::from_slice(&env, &[0u8; 64]);

    let mut payments: SorobanVec<BatchPaymentItem> = SorobanVec::new(&env);

    for i in 0..num_items {
        let is_invalid = (invalid_mask >> (i % 8)) & 1 == 1;

        let (order_id, amount, memo) = if is_invalid {
            match invalid_strategy {
                0 => (
                    // valid order_id, zero amount (should fail InvalidAmount)
                    SorobanString::from_str(&env, &format!("ORDER_{}", i)),
                    0_i128,
                    SorobanString::from_str(&env, "valid memo"),
                ),
                1 => (
                    // valid order_id, negative amount
                    SorobanString::from_str(&env, &format!("ORDER_{}", i)),
                    -1_i128,
                    SorobanString::from_str(&env, "valid memo"),
                ),
                2 => (
                    // 65-char order_id (exceeds 64-char limit → InvalidInput)
                    SorobanString::from_str(
                        &env,
                        "12345678901234567890123456789012345678901234567890123456789012345",
                    ),
                    100_i128,
                    SorobanString::from_str(&env, "valid memo"),
                ),
                _ => (
                    // 257-char memo (exceeds MAX_MEMO_LENGTH → InvalidMemoLength)
                    SorobanString::from_str(&env, &format!("ORDER_{}", i)),
                    100_i128,
                    SorobanString::from_str(
                        &env,
                        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\
                         AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\
                         AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\
                         AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\
                         A",
                    ),
                ),
            }
        } else {
            (
                SorobanString::from_str(&env, &format!("ORDER_{}", i)),
                100_i128,
                SorobanString::from_str(&env, "valid memo"),
            )
        };

        payments.push_back(BatchPaymentItem {
            order_id,
            merchant_address: merchant.clone(),
            token_address: token.clone(),
            amount,
            memo,
            signature: sig.clone(),
            merchant_public_key: pub_key.clone(),
        });
    }

    // ── Execute and assert invariants (no panics) ─────────────────────────────

    let result = client.try_batch_payment(&payer, &payments);

    match num_items {
        0 => {
            // Empty batch: contract should succeed (nothing to do)
            // Graceful return is acceptable; must not panic.
            let _ = result;
        }
        n if n > 10 => {
            // Over-limit batch must be rejected with BatchSizeExceeded
            assert_eq!(
                result,
                Err(Ok(PaymentError::BatchSizeExceeded)),
                "batch of {} items must return BatchSizeExceeded",
                n
            );
        }
        _ => {
            // 1–10 items: if all items are valid, the batch must succeed.
            // If any item is invalid, the batch must fail gracefully (no panic).
            if invalid_mask == 0 {
                // All-valid items — expect success
                assert!(
                    result.is_ok(),
                    "all-valid batch of {} items should succeed",
                    num_items
                );
            } else {
                // Contains at least one invalid item — must fail, never panic
                assert!(
                    result.is_err(),
                    "batch with invalid items must return an error"
                );
            }
        }
    }
});
