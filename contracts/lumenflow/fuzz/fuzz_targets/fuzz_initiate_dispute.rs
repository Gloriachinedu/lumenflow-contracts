#![no_main]

use libfuzzer_sys::fuzz_target;
use lumenflow::{LumenflowContract, LumenflowContractClient};
use soroban_sdk::{testutils::Address as _, Address, Bytes, Env, String};

fuzz_target!(|data: &[u8]| {
    // Need at least a few bytes to derive inputs.
    if data.len() < 4 {
        return;
    }

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, LumenflowContract);
    let client = LumenflowContractClient::new(&env, &contract_id);

    // Derive an arbitrary order id from the first 4 bytes.
    let order_id = u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as u64;

    // Split the remaining bytes into reason and evidence.
    let rest = &data[4..];
    let split = if rest.is_empty() { 0 } else { rest.len() / 2 };
    let reason_bytes = &rest[..split];
    let evidence_bytes = &rest[split..];

    // Build a reason string from arbitrary bytes, bounded to a sane length.
    let reason_len = core::cmp::min(reason_bytes.len(), 256);
    let reason_str = core::str::from_utf8(&reason_bytes[..reason_len]).unwrap_or("invalid");
    let reason = String::from_str(&env, reason_str);

    // Build evidence bytes from arbitrary input.
    let evidence = Bytes::from_slice(&env, evidence_bytes);

    let caller = Address::generate(&env);

    // Attempt to initiate a dispute. Unknown payments must return a typed
    // error rather than panicking; valid inputs must not panic either.
    let result = client.try_initiate_dispute(&caller, &order_id, &reason, &evidence);

    // The call must either succeed or return a typed error. A panic would
    // abort the fuzz run, so reaching here is the success condition.
    let _ = result;
});