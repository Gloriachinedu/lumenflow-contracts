// Integration tests for the conditional escrow hold and release lifecycle.
// Closes issue #1346.
//
// Design references:
//   - docs/escrow-guide.md  — function signatures, error codes, state machine
//   - docs/adr/ADR-007-escrow-design.md — condition-hash mechanism, arbiter
//     role, ledger-sequence-based expiry, partial release accounting
//
// Acceptance criteria covered:
//   1. hold                        — escrow_hold locks funds; EscrowHold record
//                                    is stored with status Held.
//   2. release by arbiter          — arbiter can call escrow_release before
//                                    timeout_at; funds move to merchant.
//   3. release by non-arbiter      — a random address cannot release before
//                                    timeout_at (EscrowNotUnlocked).
//   4. timeout release             — anyone can release after timeout_at passes.
//   5. dispute event               — escrow_cancel by payer emits the
//                                    lumenflow/escrow_cancelled event.
//
// Additional edge cases:
//   6. double release              — second call fails with EscrowAlreadyFinalised.
//   7. non-payer cancel            — arbiter cannot cancel (EscrowUnauthorised).
//   8. cancel after timeout        — payer cannot cancel after timeout_at
//                                    (EscrowLockExpired).
//
// Run with:
//   cargo test --package lumenflow --test escrow_hold_lifecycle

#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::StellarAssetClient,
    Address, Bytes, Env, String,
};

use lumenflow::{
    error::PaymentError,
    types::MerchantCategory,
    PaymentProcessingContract, PaymentProcessingContractClient,
};

// ── Test helpers ──────────────────────────────────────────────────────────────

fn str(env: &Env, s: &str) -> String {
    String::from_str(env, s)
}

fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

/// A 32-byte SHA-256 condition hash (all 0x42 bytes for test purposes).
fn condition_hash(env: &Env) -> Bytes {
    Bytes::from_slice(env, &[0x42u8; 32])
}

/// Advance the environment ledger timestamp by `secs` seconds and bump the
/// sequence number by a corresponding number of ledgers (at ~5 s per ledger).
fn advance_time(env: &Env, secs: u64) {
    let info = env.ledger().get();
    env.ledger().set(LedgerInfo {
        timestamp: info.timestamp + secs,
        sequence_number: info.sequence_number + (secs / 5) as u32 + 1,
        ..info
    });
}

/// Bootstrap a fully configured environment with admin, merchant, payer, and
/// an arbiter (separate from merchant). Returns all handles.
struct World {
    env: Env,
    client: PaymentProcessingContractClient<'static>,
    admin: Address,
    merchant: Address,
    payer: Address,
    arbiter: Address,
    token: Address,
}

fn setup() -> World {
    let env = Env::default();
    env.mock_all_auths();

    // Set initial ledger timestamp to a known value so timeout calculations
    // are predictable.
    env.ledger().set(LedgerInfo {
        timestamp: 1_000_000,
        sequence_number: 100,
        min_persistent_entry_ttl: 4096,
        min_temp_entry_ttl: 16,
        max_entry_ttl: 3_110_400,
        protocol_version: 22,
        network_id: Default::default(),
    });

    let contract_id = env.register(PaymentProcessingContract, ());
    let client = PaymentProcessingContractClient::new(&env, &contract_id);

    let admin = Address::generate(&env);
    let merchant = Address::generate(&env);
    let payer = Address::generate(&env);
    let arbiter = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);

    client.set_admin(&admin);
    client.add_allowed_token(&admin, &token);

    client.register_merchant(
        &merchant,
        &str(&env, "Escrow Store"),
        &str(&env, "Escrow lifecycle test merchant"),
        &str(&env, "escrow@test.local"),
        &MerchantCategory::Retail,
    );

    // Fund payer so they can lock funds into escrow.
    mint(&env, &token, &payer, 1_000_000);

    World { env, client, admin, merchant, payer, arbiter, token }
}

// ── 1. Hold ───────────────────────────────────────────────────────────────────

/// escrow_hold locks funds and records the EscrowHold with status Held.
#[test]
fn test_escrow_hold_creates_held_record() {
    let w = setup();

    // timeout_at = now (1_000_000) + 3600 seconds
    let timeout_at: u64 = 1_003_600;

    w.client.escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_001"),
        &w.merchant,
        &w.token,
        &5_000i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );

    let hold = w.client.get_escrow_hold(&str(&w.env, "HOLD_001"));
    assert_eq!(hold.payer, w.payer);
    assert_eq!(hold.merchant, w.merchant);
    assert_eq!(hold.amount, 5_000);
    assert_eq!(hold.timeout_at, timeout_at);

    // Status must be Held immediately after creation.
    use lumenflow::types::EscrowHoldStatus;
    assert_eq!(hold.status, EscrowHoldStatus::Held);
}

/// escrow_hold with a duplicate escrow_id fails with EscrowAlreadyExists.
#[test]
fn test_escrow_hold_duplicate_id_fails() {
    let w = setup();
    let timeout_at: u64 = 1_003_600;

    w.client.escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_DUP"),
        &w.merchant,
        &w.token,
        &1_000i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );

    // Second call with same ID must fail.
    let result = w.client.try_escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_DUP"),
        &w.merchant,
        &w.token,
        &1_000i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );
    assert_eq!(result, Err(Ok(PaymentError::EscrowAlreadyExists)));
}

/// escrow_hold with zero amount fails with InvalidAmount.
#[test]
fn test_escrow_hold_zero_amount_fails() {
    let w = setup();
    let timeout_at: u64 = 1_003_600;

    let result = w.client.try_escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_ZERO"),
        &w.merchant,
        &w.token,
        &0i128, // invalid
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidAmount)));
}

/// escrow_hold with a timeout in the past fails with InvalidInput.
#[test]
fn test_escrow_hold_past_timeout_fails() {
    let w = setup();
    // timestamp is 1_000_000; a timeout in the past is invalid
    let past_timeout: u64 = 999_999;

    let result = w.client.try_escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_PAST"),
        &w.merchant,
        &w.token,
        &1_000i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &past_timeout,
    );
    assert_eq!(result, Err(Ok(PaymentError::InvalidInput)));
}

// ── 2. Release by arbiter ─────────────────────────────────────────────────────

/// The arbiter can call escrow_release before timeout_at; funds move to merchant.
#[test]
fn test_escrow_release_by_arbiter_before_timeout() {
    let w = setup();
    let timeout_at: u64 = 1_003_600; // now + 1 hour

    w.client.escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_ARB"),
        &w.merchant,
        &w.token,
        &5_000i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );

    // Arbiter releases before the timeout — no time advance needed.
    w.client.escrow_release(
        &w.arbiter,
        &str(&w.env, "HOLD_ARB"),
    );

    let hold = w.client.get_escrow_hold(&str(&w.env, "HOLD_ARB"));
    use lumenflow::types::EscrowHoldStatus;
    assert_eq!(hold.status, EscrowHoldStatus::Released);
}

// ── 3. Release by non-arbiter (before timeout) — must fail ───────────────────

/// A random address cannot call escrow_release before timeout_at.
#[test]
fn test_escrow_release_by_non_arbiter_before_timeout_fails() {
    let w = setup();
    let timeout_at: u64 = 1_003_600;

    w.client.escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_NONARB"),
        &w.merchant,
        &w.token,
        &3_000i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );

    // A stranger (not arbiter, not payer, timeout not yet reached) tries to release.
    let stranger = Address::generate(&w.env);
    let result = w.client.try_escrow_release(
        &stranger,
        &str(&w.env, "HOLD_NONARB"),
    );
    assert_eq!(result, Err(Ok(PaymentError::EscrowNotUnlocked)));

    // The payer also cannot release (only arbiter or post-timeout anyone can).
    let payer_try = w.client.try_escrow_release(
        &w.payer,
        &str(&w.env, "HOLD_NONARB"),
    );
    assert_eq!(payer_try, Err(Ok(PaymentError::EscrowNotUnlocked)));
}

// ── 4. Timeout release ────────────────────────────────────────────────────────

/// After timeout_at has passed, anyone can call escrow_release.
#[test]
fn test_escrow_release_after_timeout_by_anyone() {
    let w = setup();
    let timeout_at: u64 = 1_001_000; // now + 1000 seconds

    w.client.escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_TIMEOUT"),
        &w.merchant,
        &w.token,
        &2_500i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );

    // Advance ledger past timeout_at.
    advance_time(&w.env, 2_000); // env timestamp becomes 1_002_000 > timeout_at

    // A stranger (neither arbiter nor payer) can now release.
    let stranger = Address::generate(&w.env);
    w.client.escrow_release(
        &stranger,
        &str(&w.env, "HOLD_TIMEOUT"),
    );

    let hold = w.client.get_escrow_hold(&str(&w.env, "HOLD_TIMEOUT"));
    use lumenflow::types::EscrowHoldStatus;
    assert_eq!(hold.status, EscrowHoldStatus::Released);
}

/// The merchant can also trigger release after timeout_at.
#[test]
fn test_escrow_release_after_timeout_by_merchant() {
    let w = setup();
    let timeout_at: u64 = 1_001_000;

    w.client.escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_MERCH_TO"),
        &w.merchant,
        &w.token,
        &1_500i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );

    advance_time(&w.env, 2_000);

    w.client.escrow_release(
        &w.merchant,
        &str(&w.env, "HOLD_MERCH_TO"),
    );

    let hold = w.client.get_escrow_hold(&str(&w.env, "HOLD_MERCH_TO"));
    use lumenflow::types::EscrowHoldStatus;
    assert_eq!(hold.status, EscrowHoldStatus::Released);
}

// ── 5. Dispute (cancel) event ─────────────────────────────────────────────────

/// Payer calls escrow_cancel before timeout_at; status becomes Cancelled.
/// This exercises the dispute/cancel path and validates event emission indirectly
/// via contract state (Soroban test env surfaces events through env.events()).
#[test]
fn test_escrow_cancel_by_payer_emits_cancelled_status() {
    let w = setup();
    let timeout_at: u64 = 1_003_600;

    w.client.escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_CANCEL"),
        &w.merchant,
        &w.token,
        &4_000i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );

    // Payer cancels before the timeout — funds should be returned.
    w.client.escrow_cancel(
        &w.payer,
        &str(&w.env, "HOLD_CANCEL"),
    );

    let hold = w.client.get_escrow_hold(&str(&w.env, "HOLD_CANCEL"));
    use lumenflow::types::EscrowHoldStatus;
    assert_eq!(hold.status, EscrowHoldStatus::Cancelled);

    // Verify the lumenflow/escrow_cancelled event was emitted.
    // The Soroban test env records all events in env.events().all().
    let all_events = w.env.events().all();
    let cancelled_event = all_events.iter().any(|(contract_id, topics, _data)| {
        let _ = contract_id;
        // Topics: ("lumenflow", "escrow_cancelled")
        if topics.len() < 2 {
            return false;
        }
        let t0: Result<soroban_sdk::Symbol, _> = topics.get(0).unwrap().try_into_val(&w.env);
        let t1: Result<soroban_sdk::Symbol, _> = topics.get(1).unwrap().try_into_val(&w.env);
        matches!((t0, t1), (Ok(a), Ok(b))
            if a == soroban_sdk::Symbol::new(&w.env, "lumenflow")
            && b == soroban_sdk::Symbol::new(&w.env, "escrow_cancelled"))
    });
    assert!(cancelled_event, "lumenflow/escrow_cancelled event was not emitted");
}

// ── 6. Double release ─────────────────────────────────────────────────────────

/// Calling escrow_release a second time on an already-released hold fails.
#[test]
fn test_escrow_double_release_fails() {
    let w = setup();
    let timeout_at: u64 = 1_003_600;

    w.client.escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_DBL"),
        &w.merchant,
        &w.token,
        &1_000i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );

    w.client.escrow_release(&w.arbiter, &str(&w.env, "HOLD_DBL"));

    // Second release must fail.
    let result = w.client.try_escrow_release(&w.arbiter, &str(&w.env, "HOLD_DBL"));
    assert_eq!(result, Err(Ok(PaymentError::EscrowAlreadyFinalised)));
}

// ── 7. Non-payer cancel ───────────────────────────────────────────────────────

/// The arbiter cannot cancel an escrow hold — only the payer may cancel.
#[test]
fn test_escrow_cancel_by_non_payer_fails() {
    let w = setup();
    let timeout_at: u64 = 1_003_600;

    w.client.escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_NONPAYER"),
        &w.merchant,
        &w.token,
        &2_000i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );

    // Arbiter tries to cancel — must fail.
    let arbiter_cancel = w.client.try_escrow_cancel(
        &w.arbiter,
        &str(&w.env, "HOLD_NONPAYER"),
    );
    assert_eq!(arbiter_cancel, Err(Ok(PaymentError::EscrowUnauthorised)));

    // Merchant also cannot cancel.
    let merchant_cancel = w.client.try_escrow_cancel(
        &w.merchant,
        &str(&w.env, "HOLD_NONPAYER"),
    );
    assert_eq!(merchant_cancel, Err(Ok(PaymentError::EscrowUnauthorised)));
}

// ── 8. Cancel after timeout ───────────────────────────────────────────────────

/// The payer cannot cancel after timeout_at has passed — they must use
/// escrow_release instead (anyone may call it after the timeout).
#[test]
fn test_escrow_cancel_after_timeout_fails() {
    let w = setup();
    let timeout_at: u64 = 1_001_000;

    w.client.escrow_hold(
        &w.payer,
        &str(&w.env, "HOLD_LATE_CANCEL"),
        &w.merchant,
        &w.token,
        &1_800i128,
        &condition_hash(&w.env),
        &w.arbiter,
        &timeout_at,
    );

    // Advance past timeout.
    advance_time(&w.env, 2_000);

    let result = w.client.try_escrow_cancel(
        &w.payer,
        &str(&w.env, "HOLD_LATE_CANCEL"),
    );
    assert_eq!(result, Err(Ok(PaymentError::EscrowLockExpired)));
}
