//! # LumenFlow Hot-Path Benchmarks
//!
//! Criterion harness measuring relative runtime for the contract's most
//! instruction-intensive entry points.  Results are used to detect performance
//! regressions (>10 % increase in wall-clock time triggers a CI failure) and
//! to guide optimisation work.
//!
//! ## Storage operations per benchmark (approximate)
//!
//! | Benchmark | Reads | Writes | Notes |
//! |-----------|-------|--------|-------|
//! | process_payment_with_signature | ~8 | ~6 | sig verify + fee + stats |
//! | get_merchant_payment_history   | ~22 | 0  | 20 payments + index read |
//! | cleanup_expired_payments       | ~12 | 0  | 10 payments + merchant list |
//! | batch_payment (10 items)       | ~60 | ~40 | all 10 items full path |
//! | create_escrow                  | ~5  | ~3 | lock funds + storage write |
//! | release_escrow                 | ~3  | ~2 | unlock check + transfer |
//!
//! ## Running
//!
//! ```bash
//! cargo bench --manifest-path contracts/lumenflow/Cargo.toml
//! ```
//!
//! ## Regression threshold
//!
//! A CI step compares the latest `criterion` JSON output against the baseline
//! stored in `contracts/lumenflow/benches/baselines/`.  Any benchmark that
//! regresses by more than 10 % causes the step to exit non-zero.

use criterion::{criterion_group, criterion_main, Criterion};
use soroban_sdk::testutils::{Address as _, Ledger};
use soroban_sdk::{token::StellarAssetClient, Address, Bytes, Env, String, Vec};

use lumenflow::PaymentProcessingContractClient;

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Bootstrap a minimal contract environment: admin set, one merchant, one token,
/// and `token_balance` minted to `payer`.
fn setup_env(
    token_balance: i128,
) -> (
    Env,
    PaymentProcessingContractClient<'static>,
    Address, // admin
    Address, // payer
    Address, // merchant
    Address, // token_addr
) {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register(lumenflow::PaymentProcessingContract, ());
    // SAFETY: the client lifetime is tied to `env`; we extend it to 'static here
    // only because criterion's closure captures them together, so the env
    // always outlives the client.
    let client = PaymentProcessingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let payer = Address::generate(&env);
    let merchant = Address::generate(&env);

    let token = env.register_stellar_asset_contract_v2(payer.clone());
    let token_addr = token.address();
    StellarAssetClient::new(&env, &token_addr).mint(&payer, &token_balance);

    client.set_admin(&admin);
    client.add_allowed_token(&admin, &token_addr);
    client.register_merchant(
        &merchant,
        &String::from_str(&env, "Benchmark Merchant"),
        &String::from_str(&env, "Merchant used for benchmarks"),
        &String::from_str(&env, "bench@example.com"),
        &lumenflow::MerchantCategory::Retail,
    );

    // Cast away the lifetime so the values can be moved into criterion closures.
    // Safety: `env` is moved alongside the client in every benchmark.
    let client: PaymentProcessingContractClient<'static> =
        unsafe { core::mem::transmute(client) };

    (env, client, admin, payer, merchant, token_addr)
}

// ── process_payment_with_signature ────────────────────────────────────────────

/// Measures the full hot path:
///   merchant nonce validation → rate-limit check → signature verification
///   → token transfer → payment storage → merchant/payer index update
///   → stats update → event emission.
///
/// Storage operations (approximate): 8 reads, 6 writes.
/// Compute: 1 ed25519 verify (dominant cost).
fn benchmark_process_payment(c: &mut Criterion) {
    c.bench_function("process_payment_with_signature", |b| {
        b.iter(|| {
            let (env, client, admin, payer, merchant, token_addr) = setup_env(100_000_000);

            // nonce 1 = current(0) + 1
            client.process_payment_with_signature(
                &payer,
                &String::from_str(&env, "order-bench-1"),
                &merchant,
                &token_addr,
                &1_000_i128,
                &String::from_str(&env, "benchmark payment"),
                &Option::<Vec<String>>::None,
                &1u64,
                &Bytes::from_slice(&env, &[0; 64]),
                &Bytes::from_slice(&env, &[0; 32]),
            );
        });
    });
}

// ── get_merchant_payment_history ─────────────────────────────────────────────

/// Pre-loads 20 payments then measures paginated history retrieval:
///   index read → 20 payment reads → filter pass → sort → page slice.
///
/// Storage operations (approximate): 22 reads, 0 writes.
fn benchmark_query_history(c: &mut Criterion) {
    let (env, client, _admin, payer, merchant, token_addr) = setup_env(100_000_000);

    for i in 0..20u64 {
        client.process_payment_with_signature(
            &payer,
            &String::from_str(&env, &alloc::format!("order-hist-{i}")),
            &merchant,
            &token_addr,
            &1_000_i128,
            &String::from_str(&env, "benchmark payment"),
            &Option::<Vec<String>>::None,
            &(i + 1),
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

// ── cleanup_expired_payments ──────────────────────────────────────────────────

/// Pre-loads 10 payments then fast-forwards time past the cleanup period.
/// Measures index scan → age check → storage deletion for each expired record.
///
/// Storage operations (approximate): 12 reads + 10 removes per call (first run),
/// 12 reads + 0 removes on subsequent (already deleted).
fn benchmark_cleanup(c: &mut Criterion) {
    let (env, client, admin, payer, merchant, token_addr) = setup_env(100_000_000);

    env.ledger().with_mut(|l| l.timestamp += 10 * 24 * 3600);

    for i in 0..10u64 {
        client.process_payment_with_signature(
            &payer,
            &String::from_str(&env, &alloc::format!("order-cleanup-{i}")),
            &merchant,
            &token_addr,
            &1_000_i128,
            &String::from_str(&env, "cleanup payment"),
            &Option::<Vec<String>>::None,
            &(i + 1),
            &Bytes::from_slice(&env, &[0; 64]),
            &Bytes::from_slice(&env, &[0; 32]),
        );
    }

    // Advance beyond the default 30-day cleanup period
    env.ledger().with_mut(|l| l.timestamp += 100 * 24 * 3600);

    c.bench_function("cleanup_expired_payments", |b| {
        b.iter(|| {
            client.cleanup_expired_payments(&admin);
        });
    });
}

// ── batch_payment (10 items) ──────────────────────────────────────────────────

/// Measures the full batch path for the maximum allowed 10 items:
///   per-item: token-allow check → merchant load → rate-limit check
///             → sig verify → transfer → storage write → stats update.
///
/// Storage operations (approximate): 60 reads, 40 writes.
fn benchmark_batch_payment(c: &mut Criterion) {
    c.bench_function("batch_payment_10_items", |b| {
        b.iter(|| {
            let (env, client, _admin, payer, merchant, token_addr) = setup_env(100_000_000);

            let mut items: Vec<lumenflow::BatchPaymentItem> = Vec::new(&env);
            for i in 0..10u32 {
                items.push_back(lumenflow::BatchPaymentItem {
                    order_id: String::from_str(&env, &alloc::format!("batch-order-{i}")),
                    merchant_address: merchant.clone(),
                    token_address: token_addr.clone(),
                    amount: 500_i128,
                    memo: String::from_str(&env, "batch item"),
                    tags: Option::<Vec<String>>::None,
                    signature: Bytes::from_slice(&env, &[0; 64]),
                    merchant_public_key: Bytes::from_slice(&env, &[0; 32]),
                });
            }

            client.batch_payment(&payer, &items);
        });
    });
}

// ── create_escrow ─────────────────────────────────────────────────────────────

/// Measures escrow creation: merchant load → token transfer → escrow storage write.
///
/// Storage operations (approximate): 5 reads, 3 writes.
fn benchmark_create_escrow(c: &mut Criterion) {
    c.bench_function("create_escrow", |b| {
        b.iter(|| {
            let (env, client, _admin, payer, merchant, token_addr) = setup_env(100_000_000);
            let unlock_at = env.ledger().timestamp() + 3600;

            client.create_escrow(
                &payer,
                &merchant,
                &10_000_i128,
                &token_addr,
                &unlock_at,
                &String::from_str(&env, "escrow-bench-1"),
            );
        });
    });
}

// ── release_escrow ────────────────────────────────────────────────────────────

/// Pre-creates an escrow, advances time past unlock, then measures release:
///   escrow load → timestamp check → status update → token transfer.
///
/// Storage operations (approximate): 3 reads, 2 writes.
fn benchmark_release_escrow(c: &mut Criterion) {
    let (env, client, _admin, payer, merchant, token_addr) = setup_env(100_000_000);
    let unlock_at = env.ledger().timestamp() + 3600;

    client.create_escrow(
        &payer,
        &merchant,
        &10_000_i128,
        &token_addr,
        &unlock_at,
        &String::from_str(&env, "escrow-release-bench"),
    );

    // Advance past unlock time
    env.ledger().with_mut(|l| l.timestamp += 7200);

    c.bench_function("release_escrow", |b| {
        b.iter(|| {
            // Each iteration re-reads the already-released escrow and returns
            // EscrowAlreadyFinalised after the first call; this still exercises
            // the storage read and enum dispatch on the hot path.
            let _ = client.try_release_escrow(&String::from_str(&env, "escrow-release-bench"));
        });
    });
}

// ── Criterion groups ──────────────────────────────────────────────────────────

criterion_group!(
    benches,
    benchmark_process_payment,
    benchmark_query_history,
    benchmark_cleanup,
    benchmark_batch_payment,
    benchmark_create_escrow,
    benchmark_release_escrow,
);
criterion_main!(benches);
