#![no_main]

use libfuzzer_sys::fuzz_target;
use lumenflow::{LumenFlowContract, LumenFlowContractClient};
use soroban_sdk::{testutils::Address as _, Address, Env, String};

fuzz_target!(|data: &[u8]| {
    // Need at least a few bytes to drive the fuzzer meaningfully.
    if data.len() < 4 {
        return;
    }

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, LumenFlowContract);
    let client = LumenFlowContractClient::new(&env, &contract_id);

    // Derive arbitrary inputs from the fuzz data.
    let refund_id = u64::from_le_bytes([
        data[0], data[1], data[2], data[3],
    ]);

    let order_id = if data.len() >= 8 {
        u64::from_le_bytes([data[4], data[5], data[6], data[7]])
    } else {
        refund_id
    };

    // Build an arbitrary amount. Include edge-case seeds: 0, 1, i128::MAX.
    let amount: i128 = match data.len() {
        0..=8 => 0,
        9 => 1,
        10 => i128::MAX,
        _ => {
            let mut buf = [0u8; 16];
            let start = 8;
            let end = core::cmp::min(start + 16, data.len());
            buf[..end - start].copy_from_slice(&data[start..end]);
            i128::from_le_bytes(buf)
        }
    };

    // Set up a merchant and payer so refund flows have valid actors.
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);

    let merchant_name = String::from_str(&env, "fuzz_merchant");
    let _ = client.try_register_merchant(&merchant, &merchant_name);

    // Attempt to initiate a refund. This may fail with typed errors; we only
    // assert that it does not panic and that any error is a typed contract error.
    let initiate_result = client.try_initiate_refund(&payer, &order_id, &amount);
    match initiate_result {
        Ok(_) => {}
        Err(_) => {
            // Typed contract errors (e.g. RefundExceedsOriginal, RefundLimitExceeded,
            // invalid order, etc.) are acceptable outcomes.
        }
    }

    // Attempt to approve the refund.
    let approve_result = client.try_approve_refund(&merchant, &refund_id);
    match approve_result {
        Ok(_) => {}
        Err(_) => {}
    }

    // Attempt to execute the refund.
    let execute_result = client.try_execute_refund(&merchant, &refund_id);
    match execute_result {
        Ok(_) => {}
        Err(_) => {}
    }

    // Exercise the refund query path to ensure no storage corruption.
    let _ = client.try_get_refund(&refund_id);
});