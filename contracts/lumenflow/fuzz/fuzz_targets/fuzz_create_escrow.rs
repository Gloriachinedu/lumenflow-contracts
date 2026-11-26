#![no_main]

use libfuzzer_sys::fuzz_target;
use lumenflow::{LumenFlowContract, LumenFlowContractClient, PaymentError};
use soroban_sdk::{testutils::Address as _, Address, Env};

// Fuzz target for `create_escrow`.
//
// Drives `create_escrow` with arbitrary payer/merchant/token/amount/expiry/arbiter
// inputs. The contract must always return either `Ok` or a typed `PaymentError`
// and must never panic.
//
// Corpus seeds cover edge-case amounts (0, 1, i128::MAX) as required by #1512.

fuzz_target!(|data: &[u8]| {
    // Need at least a few bytes to derive meaningful inputs; otherwise skip.
    if data.len() < 8 {
        return;
    }

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, LumenFlowContract);
    let client = LumenFlowContractClient::new(&env, &contract_id);

    // Derive arbitrary addresses from the fuzz input.
    let payer = Address::generate(&env);
    let merchant = Address::generate(&env);
    let token = Address::generate(&env);
    let arbiter = Address::generate(&env);

    // Derive an arbitrary amount from the first 16 bytes (i128).
    let mut amount_bytes = [0u8; 16];
    amount_bytes.copy_from_slice(&data[0..16.min(data.len())]);
    let amount = i128::from_le_bytes(amount_bytes);

    // Derive an arbitrary expiry from the next 8 bytes (u64).
    let mut expiry_bytes = [0u8; 8];
    let expiry_start = 16.min(data.len());
    let expiry_end = (expiry_start + 8).min(data.len());
    expiry_bytes[..expiry_end - expiry_start]
        .copy_from_slice(&data[expiry_start..expiry_end]);
    let expiry = u64::from_le_bytes(expiry_bytes);

    // The call must never panic; it must return Ok or a typed PaymentError.
    let result = client.try_create_escrow(
        &payer,
        &merchant,
        &token,
        &amount,
        &expiry,
        &arbiter,
    );

    match result {
        Ok(_) => {}
        Err(Ok(err)) => {
            // Any typed PaymentError is acceptable; just ensure it is one of
            // the known variants so we don't silently accept unexpected errors.
            match err {
                PaymentError::InvalidAmount
                | PaymentError::InvalidExpiry
                | PaymentError::Unauthorized
                | PaymentError::MerchantNotFound
                | PaymentError::EscrowAlreadyExists
                | PaymentError::InvalidArbiter
                | PaymentError::InsufficientFunds
                | PaymentError::InvalidToken
                | PaymentError::EscrowNotFound
                | PaymentError::DisputeAlreadyExists
                | PaymentError::InvalidState => {}
            }
        }
        Err(Err(_)) => {
            // A host-level error (e.g. conversion failure) is also acceptable
            // as long as it is not a panic. Panics would abort the fuzz run.
        }
    }
});

// Corpus seeds for edge-case amounts (0, 1, i128::MAX).
//
// These are registered via `fuzz/corpus/fuzz_create_escrow/` files; the
// helper below documents the byte layout used by the target so seeds can be
// generated deterministically:
//
//   bytes[0..16]  -> amount (i128, little-endian)
//   bytes[16..24] -> expiry (u64, little-endian)
//
// Seed 0: amount = 0
//   [0u8; 16] ++ [0u8; 8]
// Seed 1: amount = 1
//   [1, 0, 0, ...] ++ [0u8; 8]
// Seed 2: amount = i128::MAX
//   [0xFF; 16] ++ [0u8; 8]
#[allow(dead_code)]
fn _corpus_seed_layout() -> [[u8; 24]; 3] {
    let mut zero = [0u8; 24];
    zero[..16].copy_from_slice(&0i128.to_le_bytes());

    let mut one = [0u8; 24];
    one[..16].copy_from_slice(&1i128.to_le_bytes());

    let mut max = [0u8; 24];
    max[..16].copy_from_slice(&i128::MAX.to_le_bytes());

    [zero, one, max]
}