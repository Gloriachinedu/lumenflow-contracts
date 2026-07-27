//! # LumenFlow Router Contract (Canary Traffic Splitter) — Stub
//!
//! ## Purpose
//!
//! Soroban contracts are immutable once deployed. There is no in-place upgrade
//! mechanism. The canary deployment strategy deploys a *new* contract instance
//! (the canary) alongside the existing *stable* contract, and this router
//! contract decides which one receives each incoming call.
//!
//! ## Traffic splitting logic
//!
//! The router reads a `CANARY_WEIGHT` value from contract instance storage
//! (default: 5, meaning 5%). For each incoming `route_call`, it uses:
//!
//! ```text
//! ledger_sequence_number mod 100 < CANARY_WEIGHT  →  forward to canary
//! otherwise                                        →  forward to stable
//! ```
//!
//! This produces a deterministic, pseudo-random split that requires no extra
//! randomness source. At weight=5 approximately 5 out of every 100 ledger
//! sequences are routed to the canary.
//!
//! ## Deployment workflow
//!
//! ```
//! scripts/deploy-canary.sh   →  deploys canary, stores CANARY_CONTRACT_ID
//!        ↓
//! set_canary_contract(canary_id)   →  tells router the canary address
//!        ↓
//! set_stable_contract(stable_id)  →  tells router the stable address
//!        ↓
//! (monitor error rates on both contracts)
//!        ↓
//! set_canary_weight(0)            →  disable canary routing
//!                   OR
//! scripts/promote-canary.sh      →  promote canary to stable
//! ```
//!
//! ## Implementation note
//!
//! Full cross-contract calls in Soroban require knowing the target contract's
//! ABI at compile time (or using `call_with_args` for dynamic dispatch). This
//! stub demonstrates the routing *decision* logic and storage layout. A
//! production router would replace the `// TODO` markers below with actual
//! `env.invoke_contract(...)` calls targeting the stable or canary contract.

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, Symbol};

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────────────

/// Persistent storage keys used by the router.
#[contracttype]
pub enum RouterKey {
    /// The stable (currently promoted) LumenFlow contract address.
    StableContract,
    /// The canary (under evaluation) LumenFlow contract address.
    CanaryContract,
    /// Traffic weight sent to the canary, expressed as an integer percentage
    /// in the range 0–100. Default: 5 (5%).
    CanaryWeight,
    /// Address that is allowed to call admin functions on this router.
    Admin,
}

// ─────────────────────────────────────────────────────────────────────────────
// Contract
// ─────────────────────────────────────────────────────────────────────────────

#[contract]
pub struct RouterContract;

#[contractimpl]
impl RouterContract {
    // ── Admin initialisation ──────────────────────────────────────────────

    /// Set the router admin. Must be called once after deployment.
    pub fn set_admin(env: Env, admin: Address) {
        // Only allow initialisation if no admin is set yet.
        if env
            .storage()
            .instance()
            .has(&RouterKey::Admin)
        {
            let current: Address = env.storage().instance().get(&RouterKey::Admin).unwrap();
            current.require_auth();
        }
        env.storage()
            .instance()
            .set(&RouterKey::Admin, &admin);
    }

    // ── Configuration setters (admin-only) ────────────────────────────────

    /// Register the stable LumenFlow contract address.
    pub fn set_stable_contract(env: Env, admin: Address, stable_id: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&RouterKey::StableContract, &stable_id);
    }

    /// Register the canary LumenFlow contract address.
    pub fn set_canary_contract(env: Env, admin: Address, canary_id: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&RouterKey::CanaryContract, &canary_id);
    }

    /// Set the canary traffic weight (0–100, representing a percentage).
    ///
    /// - weight=0  → 100% traffic to stable (canary disabled)
    /// - weight=5  → 5% to canary, 95% to stable  (default)
    /// - weight=100 → 100% to canary (full cutover before promotion)
    pub fn set_canary_weight(env: Env, admin: Address, weight: u32) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        assert!(weight <= 100, "weight must be in range 0–100");
        env.storage()
            .instance()
            .set(&RouterKey::CanaryWeight, &weight);
    }

    // ── Routing ───────────────────────────────────────────────────────────

    /// Determine which contract should handle the current call and return its
    /// address. Callers invoke the returned contract directly.
    ///
    /// ## Routing algorithm
    ///
    /// ```text
    /// canary_weight  = storage[CANARY_WEIGHT]  (default: 5)
    /// ledger_seq     = env.ledger().sequence()
    /// bucket         = ledger_seq mod 100
    ///
    /// if bucket < canary_weight  →  route to canary
    /// else                       →  route to stable
    /// ```
    ///
    /// The ledger sequence is a monotonically increasing integer. Taking it
    /// mod 100 yields a value in [0, 99] that cycles evenly, giving each
    /// weight bucket an equal share of calls without external randomness.
    ///
    /// ## Return value
    ///
    /// Returns the `Address` of the contract that should handle this call.
    /// The caller is responsible for forwarding the actual invocation.
    pub fn route_call(env: Env) -> Address {
        let canary_weight: u32 = env
            .storage()
            .instance()
            .get(&RouterKey::CanaryWeight)
            .unwrap_or(5u32); // default: 5%

        let ledger_seq: u32 = env.ledger().sequence();
        let bucket: u32 = ledger_seq % 100;

        if bucket < canary_weight {
            // Route this call to the canary contract
            let canary: Address = env
                .storage()
                .instance()
                .get(&RouterKey::CanaryContract)
                .expect("canary contract not configured — call set_canary_contract first");

            env.events().publish(
                (Symbol::new(&env, "lumenflow"), Symbol::new(&env, "routed_to_canary")),
                ledger_seq,
            );

            // TODO: In production, forward the call to the canary contract:
            //   env.invoke_contract(&canary, &function_name, args)
            // For now, return the address so the caller can dispatch.
            canary
        } else {
            // Route this call to the stable contract (the common path)
            let stable: Address = env
                .storage()
                .instance()
                .get(&RouterKey::StableContract)
                .expect("stable contract not configured — call set_stable_contract first");

            env.events().publish(
                (Symbol::new(&env, "lumenflow"), Symbol::new(&env, "routed_to_stable")),
                ledger_seq,
            );

            // TODO: In production, forward the call to the stable contract:
            //   env.invoke_contract(&stable, &function_name, args)
            // For now, return the address so the caller can dispatch.
            stable
        }
    }

    // ── Read-only helpers ─────────────────────────────────────────────────

    /// Return the currently configured canary weight (percentage).
    pub fn get_canary_weight(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&RouterKey::CanaryWeight)
            .unwrap_or(5u32)
    }

    /// Return the stable contract address, if configured.
    pub fn get_stable_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&RouterKey::StableContract)
    }

    /// Return the canary contract address, if configured.
    pub fn get_canary_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&RouterKey::CanaryContract)
    }

    // ── Internal helpers ──────────────────────────────────────────────────

    fn require_admin(env: &Env, caller: &Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&RouterKey::Admin)
            .expect("router admin not set — call set_admin first");
        assert!(
            *caller == admin,
            "caller is not the router admin"
        );
    }
}
