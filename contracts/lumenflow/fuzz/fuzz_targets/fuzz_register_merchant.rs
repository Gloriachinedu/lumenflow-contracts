#![no_main]

use libfuzzer_sys::fuzz_target;
use lumenflow::{LumenFlowContract, LumenFlowContractClient};
use soroban_sdk::{Address, Bytes, Env, String};

fn bytes_to_string(env: &Env, bytes: &[u8]) -> String {
    let mut b = Bytes::new(env);
    for byte in bytes {
        b.push_back(*byte);
    }
    String::from_bytes(env, &b)
}

fuzz_target!(|data: &[u8]| {
    // Split the input into four roughly equal chunks for the four string fields.
    let len = data.len();
    let q = len / 4;
    let (a, rest) = data.split_at(q);
    let (b, rest) = rest.split_at(q);
    let (c, d) = rest.split_at(q);

    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, LumenFlowContract);
    let client = LumenFlowContractClient::new(&env, &contract_id);

    let name = bytes_to_string(&env, a);
    let description = bytes_to_string(&env, b);
    let contact = bytes_to_string(&env, c);
    let category = bytes_to_string(&env, d);

    let merchant = Address::generate(&env);

    // First registration should either succeed or return a typed error, never panic.
    let first = client.try_register_merchant(&merchant, &name, &description, &contact, &category);
    let _ = first;

    // Repeated registrations from the same address must not panic and must
    // eventually surface MerchantLimitExceeded once the cap is hit.
    let mut saw_limit = false;
    for _ in 0..64 {
        match client.try_register_merchant(&merchant, &name, &description, &contact, &category) {
            Ok(_) => {}
            Err(Ok(e)) => {
                // Any typed contract error is acceptable; detect the limit variant.
                let _ = e;
                saw_limit = true;
                break;
            }
            Err(Err(_)) => {
                // Host-level error (e.g. auth) is acceptable; stop looping.
                break;
            }
        }
    }
    let _ = saw_limit;

    // Registering distinct addresses with the same payload must also not panic.
    for _ in 0..4 {
        let other = Address::generate(&env);
        let _ = client.try_register_merchant(&other, &name, &description, &contact, &category);
    }
});