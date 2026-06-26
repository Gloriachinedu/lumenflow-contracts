use criterion::{criterion_group, criterion_main, Criterion};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token::StellarAssetClient, Address, Bytes, Env, String, Vec};

use lumenflow::PaymentProcessingContractClient;

fn benchmark_process_payment(c: &mut Criterion) {
    c.bench_function("process_payment_with_signature", |b| {
        b.iter(|| {
            let env = Env::default();
            env.mock_all_auths();
            let contract_id = env.register(lumenflow::PaymentProcessingContract, ());
            let client = PaymentProcessingContractClient::new(&env, &contract_id);

            let payer = Address::generate(&env);
            let merchant = Address::generate(&env);
            let token = env.register_stellar_asset_contract_v2(payer.clone());
            let token_addr = token.address();
            let token_client = StellarAssetClient::new(&env, &token_addr);
            token_client.mint(&payer, &100_000_000_i128);

            let admin = Address::generate(&env);
            client.set_admin(&admin);
            client.add_allowed_token(&admin, &token_addr);
            client.register_merchant(
                &merchant,
                &String::from_str(&env, "Benchmark Merchant"),
                &String::from_str(&env, "Benchmark merchant"),
                &String::from_str(&env, "merchant@example.com"),
                &lumenflow::MerchantCategory::Retail,
            );

            client.process_payment_with_signature(
                &payer,
                &String::from_str(&env, "order-1"),
                &merchant,
                &token_addr,
                &1000_i128,
                &String::from_str(&env, "benchmark payment"),
                &Option::<Vec<String>>::None,
                &Bytes::from_slice(&env, &[0; 64]),
                &Bytes::from_slice(&env, &[0; 32]),
            );
        });
    });
}

fn benchmark_query_history(c: &mut Criterion) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(lumenflow::PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    let payer = Address::generate(&env);
    let merchant = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(payer.clone());
    let token_addr = token.address();
    let token_client = StellarAssetClient::new(&env, &token_addr);
    token_client.mint(&payer, &100_000_000_i128);
    client.add_allowed_token(&admin, &token_addr);
    client.register_merchant(
        &merchant,
        &String::from_str(&env, "Merchant"),
        &String::from_str(&env, "Merchant for history"),
        &String::from_str(&env, "merchant@example.com"),
        &lumenflow::MerchantCategory::Retail,
    );

    for i in 0..20 {
        client.process_payment_with_signature(
            &payer,
            &String::from_str(&env, &format!("order-{i}")),
            &merchant,
            &token_addr,
            &1000_i128,
            &String::from_str(&env, "benchmark payment"),
            &Option::<Vec<String>>::None,
            &Bytes::from_slice(&env, &[0; 64]),
            &Bytes::from_slice(&env, &[0; 32]),
        );
        env.ledger().with_mut(|l| l.timestamp += 60);
    }

    c.bench_function("get_merchant_payment_history", |b| {
        b.iter(|| {
            client.get_merchant_payment_history(
                &merchant,
                &Option::<String>::None,
                &10,
                &Option::<lumenflow::PaymentFilter>::None,
                &lumenflow::SortField::Date,
                &lumenflow::SortOrder::Descending,
            );
        });
    });
}

fn benchmark_cleanup(c: &mut Criterion) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(lumenflow::PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);
    let admin = Address::generate(&env);
    client.set_admin(&admin);
    let payer = Address::generate(&env);
    let merchant = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(payer.clone());
    let token_addr = token.address();
    let token_client = StellarAssetClient::new(&env, &token_addr);
    token_client.mint(&payer, &100_000_000_i128);
    client.add_allowed_token(&admin, &token_addr);
    client.register_merchant(
        &merchant,
        &String::from_str(&env, "Merchant"),
        &String::from_str(&env, "Merchant for cleanup"),
        &String::from_str(&env, "merchant@example.com"),
        &lumenflow::MerchantCategory::Retail,
    );

    env.ledger().with_mut(|l| l.timestamp += 10 * 24 * 3600);

    for i in 0..10 {
        client.process_payment_with_signature(
            &payer,
            &String::from_str(&env, &format!("order-cleanup-{i}")),
            &merchant,
            &token_addr,
            &1000_i128,
            &String::from_str(&env, "cleanup payment"),
            &Option::<Vec<String>>::None,
            &Bytes::from_slice(&env, &[0; 64]),
            &Bytes::from_slice(&env, &[0; 32]),
        );
    }

    env.ledger().with_mut(|l| l.timestamp += 100 * 24 * 3600);

    c.bench_function("cleanup_expired_payments", |b| {
        b.iter(|| {
            client.cleanup_expired_payments(&admin);
        });
    });
}

criterion_group!(benches, benchmark_process_payment, benchmark_query_history, benchmark_cleanup);
criterion_main!(benches);
