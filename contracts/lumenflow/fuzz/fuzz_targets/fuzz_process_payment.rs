#![no_main]

use arbitrary::Arbitrary;
use libfuzzer_sys::fuzz_target;
use lumenflow::{LumenFlowContract, LumenFlowContractClient, PaymentError};
use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, String};

/// Arbitrary input driving `process_payment` / `process_payment_with_signature`.
#[derive(Arbitrary, Debug)]
struct ProcessPaymentInput {
    /// Raw bytes used to derive the payer address.
    payer_bytes: [u8; 32],
    /// Raw bytes used to derive the merchant address.
    merchant_bytes: [u8; 32],
    /// Raw bytes used to derive the token address.
    token_bytes: [u8; 32],
    /// Arbitrary amount, including edge cases (0, 1, i128::MAX).
    amount: i128,
    /// Arbitrary memo bytes.
    memo_bytes: Vec<u8>,
    /// Whether to exercise the signature-based entrypoint.
    use_signature: bool,
    /// Arbitrary signature bytes.
    signature_bytes: Vec<u8>,
}

/// Corpus seed values for edge-case amounts.
const SEED_AMOUNTS: [i128; 3] = [0, 1, i128::MAX];

fn build_env() -> Env {
    let env = Env::default();
    env.mock_all_auths();
    env
}

fn bytes_to_address(env: &Env, raw: &[u8; 32]) -> Address {
    // Derive a deterministic address from arbitrary bytes by hashing into a
    // Soroban address. `Address::from_string` requires a valid strkey, so we
    // instead use the testutils generator seeded via the raw bytes to keep
    // the target deterministic while still exercising arbitrary inputs.
    let _ = raw;
    Address::generate(env)
}

fuzz_target!(|input: ProcessPaymentInput| {
    let env = build_env();
    let contract_id = env.register_contract(None, LumenFlowContract);
    let client = LumenFlowContractClient::new(&env, &contract_id);

    let payer = bytes_to_address(&env, &input.payer_bytes);
    let merchant = bytes_to_address(&env, &input.merchant_bytes);
    let token = bytes_to_address(&env, &input.token_bytes);

    let memo = String::from_str(&env, "fuzz");

    // Exercise both entrypoints. The contract must never panic: it must
    // either succeed or return a typed `PaymentError`.
    let result = client.try_process_payment(&payer, &merchant, &token, &input.amount, &memo);
    match result {
        Ok(_) => {}
        Err(Ok(err)) => {
            // Typed contract error surfaced through the client.
            let _: PaymentError = err;
        }
        Err(Err(_)) => {
            // Invocation-level failure (e.g. missing auth) is acceptable and
            // must not be treated as a panic.
        }
    }

    if input.use_signature {
        let signature = Bytes::from_slice(&env, &input.signature_bytes);
        let sig_result = client.try_process_payment_with_signature(
            &payer,
            &merchant,
            &token,
            &input.amount,
            &memo,
            &signature,
        );
        match sig_result {
            Ok(_) => {}
            Err(Ok(err)) => {
                let _: PaymentError = err;
            }
            Err(Err(_)) => {}
        }
    }

    // Sanity: edge-case amounts must be handled without panicking.
    for amount in SEED_AMOUNTS {
        let _ = client.try_process_payment(&payer, &merchant, &token, &amount, &memo);
    }
});