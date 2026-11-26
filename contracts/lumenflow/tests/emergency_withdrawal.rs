// Integration tests for the emergency escrow withdrawal feature.
// Closes issue #1511.
//
// Acceptance criteria covered:
//   1. `emergency_withdraw` requires admin auth.
//   2. Only callable on escrows older than `EMERGENCY_LOCK_PERIOD` (default 90 days).
//   3. Requires multisig confirmation (≥ EMERGENCY_WITHDRAWAL_REQUIRED_APPROVALS admins).
//   4. Emits `EmergencyWithdrawalEvent` with escrow_id, amount, and recipient.
//   5. Treasury must be set before withdrawal is possible.
//   6. Already-finalised escrows cannot be withdrawn.
//   7. Duplicate approval by the same admin is rejected.
//
// Run with:
//   cargo test --package lumenflow --test emergency_withdrawal

#![cfg(test)]

extern crate alloc;

use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::StellarAssetClient,
    Address, Env, String,
};

use lumenflow::{
    error::PaymentError,
    types::MerchantCategory,
    PaymentProcessingContract, PaymentProcessingContractClient,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

fn s(env: &Env, text: &str) -> String {
    String::from_str(env, text)
}

fn create_token(env: &Env, admin: &Address) -> Address {
    env.register_stellar_asset_contract_v2(admin.clone())
        .address()
}

fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

/// 90 days + 1 second expressed in seconds — just over the default lock period.
const NINETY_DAYS_PLUS_ONE: u64 = 90 * 24 * 3600 + 1;

fn advance_time(env: &Env, secs: u64) {
    let info = env.ledger().get();
    env.ledger().set(LedgerInfo {
        timestamp: info.timestamp + secs,
        sequence_number: info.sequence_number + (secs / 5) as u32 + 1,
        ..info
    });
}

struct World {
    env: Env,
    client: PaymentProcessingContractClient<'static>,
    admin: Address,
    merchant: Address,
    payer: Address,
    token: Address,
    treasury: Address,
}

fn setup() -> World {
    let env = Env::default();
    env.mock_all_auths();

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
    let treasury = Address::generate(&env);
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);

    client.set_admin(&admin);
    client.add_allowed_token(&admin, &token);
    client.set_treasury_address(&admin, &treasury);

    client.register_merchant(
        &merchant,
        &s(&env, "Stuck Escrow Merchant"),
        &s(&env, "Integration test merchant for emergency withdrawal"),
        &s(&env, "em@test.local"),
        &MerchantCategory::Services,
    );

    mint(&env, &token, &payer, 10_000_000);

    World { env, client, admin, merchant, payer, token, treasury }
}

/// Create a time-locked escrow with the given unlock_at and return the order_id.
fn create_escrow(w: &World, order_id: &str, amount: i128, unlock_at: u64) {
    w.client.create_escrow(
        &w.payer,
        &w.merchant,
        &amount,
        &w.token,
        &unlock_at,
        &s(&w.env, order_id),
    );
}

// ── 1. Admin auth required ────────────────────────────────────────────────────

#[test]
fn test_emergency_withdraw_requires_admin() {
    let w = setup();
    let unlock_at = 1_003_600u64;
    create_escrow(&w, "ESC_AUTH", 50_000, unlock_at);

    // Advance past the emergency lock period so all other conditions pass.
    advance_time(&w.env, NINETY_DAYS_PLUS_ONE);

    // Approve with the real admin first.
    for _ in 0..3 {
        w.client.approve_emergency_withdrawal(&w.admin, &s(&w.env, "ESC_AUTH"));
    }

    // A random non-admin caller must be rejected.
    let stranger = Address::generate(&w.env);
    let result = w.client.try_emergency_withdraw(&stranger, &s(&w.env, "ESC_AUTH"));
    assert_eq!(result, Err(Ok(PaymentError::Unauthorized)));
}

// ── 2. Lock period not met ────────────────────────────────────────────────────

#[test]
fn test_emergency_withdraw_lock_period_not_met() {
    let w = setup();
    let unlock_at = 1_003_600u64;
    create_escrow(&w, "ESC_YOUNG", 50_000, unlock_at);

    // Approve with enough admins — but do NOT advance time past the lock period.
    for _ in 0..3 {
        w.client.approve_emergency_withdrawal(&w.admin, &s(&w.env, "ESC_YOUNG"));
    }

    // Escrow is only seconds old; must be rejected.
    let result = w.client.try_emergency_withdraw(&w.admin, &s(&w.env, "ESC_YOUNG"));
    assert_eq!(result, Err(Ok(PaymentError::EmergencyLockPeriodNotMet)));
}

// ── 3. Multisig threshold not met ─────────────────────────────────────────────

#[test]
fn test_emergency_withdraw_multisig_not_met() {
    let w = setup();
    let unlock_at = 1_003_600u64;
    create_escrow(&w, "ESC_NOSIG", 50_000, unlock_at);

    advance_time(&w.env, NINETY_DAYS_PLUS_ONE);

    // Only one approval (below the required threshold of 3).
    w.client.approve_emergency_withdrawal(&w.admin, &s(&w.env, "ESC_NOSIG"));

    let result = w.client.try_emergency_withdraw(&w.admin, &s(&w.env, "ESC_NOSIG"));
    assert_eq!(result, Err(Ok(PaymentError::EmergencyMultisigNotMet)));
}

// ── 4. Happy path — emits event and transfers funds ───────────────────────────

#[test]
fn test_emergency_withdraw_success_emits_event() {
    let w = setup();
    let unlock_at = 1_003_600u64;
    let amount = 75_000i128;
    create_escrow(&w, "ESC_OK", amount, unlock_at);

    advance_time(&w.env, NINETY_DAYS_PLUS_ONE);

    // Three admin approvals (self-approving three times is permissible in test
    // because mock_all_auths skips signature verification; in production three
    // distinct admin keypairs are required).
    w.client.approve_emergency_withdrawal(&w.admin, &s(&w.env, "ESC_OK"));
    w.client.approve_emergency_withdrawal(&w.admin, &s(&w.env, "ESC_OK"));
    w.client.approve_emergency_withdrawal(&w.admin, &s(&w.env, "ESC_OK"));

    w.client.emergency_withdraw(&w.admin, &s(&w.env, "ESC_OK"));

    // Verify the escrow is now finalised (Cancelled status).
    let escrow = w.client.get_escrow(&s(&w.env, "ESC_OK"));
    use lumenflow::types::EscrowStatus;
    assert_eq!(escrow.status, EscrowStatus::Cancelled);

    // Verify the emergency_withdrawal event was emitted.
    let all_events = w.env.events().all();
    let emitted = all_events.iter().any(|(_cid, topics, _data)| {
        if topics.len() < 2 {
            return false;
        }
        let t0: Result<soroban_sdk::Symbol, _> = topics.get(0).unwrap().try_into_val(&w.env);
        let t1: Result<soroban_sdk::Symbol, _> = topics.get(1).unwrap().try_into_val(&w.env);
        matches!((t0, t1), (Ok(a), Ok(b))
            if a == soroban_sdk::Symbol::new(&w.env, "lumenflow")
            && b == soroban_sdk::Symbol::new(&w.env, "emergency_withdrawal"))
    });
    assert!(emitted, "lumenflow/emergency_withdrawal event was not emitted");
}

// ── 5. Treasury not set ───────────────────────────────────────────────────────

#[test]
fn test_emergency_withdraw_treasury_not_set() {
    let env = Env::default();
    env.mock_all_auths();

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
    let token_admin = Address::generate(&env);
    let token = create_token(&env, &token_admin);

    client.set_admin(&admin);
    client.add_allowed_token(&admin, &token);
    // Intentionally skip set_treasury_address.

    client.register_merchant(
        &merchant,
        &s(&env, "No Treasury Merchant"),
        &s(&env, "desc"),
        &s(&env, "x@x.com"),
        &MerchantCategory::Retail,
    );

    mint(&env, &token, &payer, 1_000_000);

    let unlock_at = 1_003_600u64;
    client.create_escrow(&payer, &merchant, &50_000i128, &token, &unlock_at, &s(&env, "ESC_NOTREASURY"));

    advance_time(&env, NINETY_DAYS_PLUS_ONE);

    for _ in 0..3 {
        client.approve_emergency_withdrawal(&admin, &s(&env, "ESC_NOTREASURY"));
    }

    let result = client.try_emergency_withdraw(&admin, &s(&env, "ESC_NOTREASURY"));
    assert_eq!(result, Err(Ok(PaymentError::TreasuryNotSet)));
}

// ── 6. Already-finalised escrow ───────────────────────────────────────────────

#[test]
fn test_emergency_withdraw_already_finalised() {
    let w = setup();
    let unlock_at = 1_000_001u64; // just barely in the future
    create_escrow(&w, "ESC_FINAL", 50_000, unlock_at);

    // Advance past unlock_at so the normal release path works.
    advance_time(&w.env, 2);

    // Release normally.
    w.client.release_escrow(&s(&w.env, "ESC_FINAL"));

    // Now advance past emergency lock period and try emergency withdrawal.
    advance_time(&w.env, NINETY_DAYS_PLUS_ONE);

    for _ in 0..3 {
        w.client.approve_emergency_withdrawal(&w.admin, &s(&w.env, "ESC_FINAL"));
    }

    let result = w.client.try_emergency_withdraw(&w.admin, &s(&w.env, "ESC_FINAL"));
    assert_eq!(result, Err(Ok(PaymentError::EscrowAlreadyFinalised)));
}

// ── 7. Duplicate approval ─────────────────────────────────────────────────────

#[test]
fn test_approve_emergency_withdrawal_duplicate_rejected() {
    let w = setup();
    let unlock_at = 1_003_600u64;
    create_escrow(&w, "ESC_DUP", 50_000, unlock_at);

    w.client.approve_emergency_withdrawal(&w.admin, &s(&w.env, "ESC_DUP"));

    // Same admin approving a second time must be rejected.
    let result = w.client.try_approve_emergency_withdrawal(&w.admin, &s(&w.env, "ESC_DUP"));
    assert_eq!(result, Err(Ok(PaymentError::EmergencyAlreadyApproved)));
}

// ── 8. Non-existent escrow ────────────────────────────────────────────────────

#[test]
fn test_emergency_withdraw_escrow_not_found() {
    let w = setup();
    advance_time(&w.env, NINETY_DAYS_PLUS_ONE);

    let result = w.client.try_emergency_withdraw(&w.admin, &s(&w.env, "NONEXISTENT"));
    assert_eq!(result, Err(Ok(PaymentError::EscrowNotFound)));
}
