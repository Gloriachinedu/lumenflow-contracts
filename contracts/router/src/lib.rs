//! # LumenFlow Router Contract — Blue-Green + Canary Traffic Splitter
//!
//! ## Purpose
//!
//! Soroban contracts are immutable once deployed. There is no in-place upgrade
//! mechanism. This router contract supports two complementary deployment
//! strategies:
//!
//! ### Blue-Green Deployment (zero-downtime upgrades)
//!
//! Two full contract instances — **blue** and **green** — are deployed in
//! parallel. The router holds an `ACTIVE_SLOT` value (`Blue` or `Green`) and
//! directs **100% of traffic** to whichever slot is active. Cutover is a
//! single atomic storage write; rollback is the same operation in reverse.
//!
//! ```text
//! blue contract   ←── 100% (active)     ┐
//!                                        │  router contract  ←── all calls
//! green contract  ←── 0%  (standby)    ─┘
//! ```
//!
//! Cutover workflow:
//! ```
//! deploy new contract to standby slot  (set_blue_contract / set_green_contract)
//!        ↓
//! validate standby with smoke test
//!        ↓
//! set_active_slot(Green)               ← atomic 1-ledger cutover
//!        ↓
//! (monitor; rollback = set_active_slot(Blue))
//! ```
//!
//! ### Canary Deployment (gradual traffic shifting)
//!
//! The router also supports the existing canary strategy where a small
//! percentage of traffic is sent to a canary contract for evaluation before
//! full promotion. The canary weight is applied **within the active slot's
//! traffic** and overrides the blue-green routing when non-zero.
//!
//! ## Storage keys
//!
//! | Key              | Type    | Purpose                                   |
//! |------------------|---------|-------------------------------------------|
//! | `Admin`          | Address | Single authorised admin                   |
//! | `BlueContract`   | Address | Blue-slot LumenFlow contract address      |
//! | `GreenContract`  | Address | Green-slot LumenFlow contract address     |
//! | `ActiveSlot`     | Slot    | Which slot is live (`Blue` or `Green`)    |
//! | `StableContract` | Address | Legacy canary field — current stable      |
//! | `CanaryContract` | Address | Legacy canary field — canary under test   |
//! | `CanaryWeight`   | u32     | % of calls sent to canary (0–100)         |
//!
//! ## Events emitted
//!
//! | Topic pair                                 | Data              |
//! |--------------------------------------------|-------------------|
//! | `("lumenflow", "routed_to_blue")`          | ledger sequence   |
//! | `("lumenflow", "routed_to_green")`         | ledger sequence   |
//! | `("lumenflow", "routed_to_canary")`        | ledger sequence   |
//! | `("lumenflow", "routed_to_stable")`        | ledger sequence   |
//! | `("lumenflow", "blue_green_cutover")`      | new active Slot   |
//! | `("lumenflow", "blue_green_rollback")`     | restored Slot     |

#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Address, Env, Symbol};

// ─────────────────────────────────────────────────────────────────────────────
// Storage keys
// ─────────────────────────────────────────────────────────────────────────────

/// Persistent instance storage keys used by the router.
#[contracttype]
#[derive(Clone)]
pub enum RouterKey {
    /// Blue-slot LumenFlow contract address.
    BlueContract,
    /// Green-slot LumenFlow contract address.
    GreenContract,
    /// Which slot is currently serving live traffic.
    ActiveSlot,
    /// The stable (currently promoted) LumenFlow contract address (canary use).
    StableContract,
    /// The canary (under evaluation) LumenFlow contract address.
    CanaryContract,
    /// Traffic weight sent to the canary, expressed as an integer percentage
    /// in the range 0–100. Default: 0 (canary disabled).
    CanaryWeight,
    /// Address that is allowed to call admin functions on this router.
    Admin,
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/// Represents which blue-green deployment slot is currently active.
#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum Slot {
    /// The blue slot is serving live traffic.
    Blue,
    /// The green slot is serving live traffic.
    Green,
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
    ///
    /// If an admin is already configured the current admin must authorise the
    /// call (admin key rotation). On first call any address may be set.
    pub fn set_admin(env: Env, admin: Address) {
        if env.storage().instance().has(&RouterKey::Admin) {
            let current: Address =
                env.storage().instance().get(&RouterKey::Admin).unwrap();
            current.require_auth();
        }
        env.storage().instance().set(&RouterKey::Admin, &admin);
    }

    // ── Blue-Green configuration setters (admin-only) ─────────────────────

    /// Register the blue-slot LumenFlow contract address.
    ///
    /// Call this before `set_active_slot` to ensure the slot is populated.
    pub fn set_blue_contract(env: Env, admin: Address, blue_id: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&RouterKey::BlueContract, &blue_id);
    }

    /// Register the green-slot LumenFlow contract address.
    ///
    /// Call this before `set_active_slot` to ensure the slot is populated.
    pub fn set_green_contract(env: Env, admin: Address, green_id: Address) {
        admin.require_auth();
        Self::require_admin(&env, &admin);
        env.storage()
            .instance()
            .set(&RouterKey::GreenContract, &green_id);
    }

    /// **Atomic blue-green cutover**: set which slot handles live traffic.
    ///
    /// This is a single instance-storage write, which Soroban commits
    /// atomically within one ledger. There is no window during which traffic
    /// is split between the two slots — the switch is all-or-nothing.
    ///
    /// The target slot **must** already be configured (via `set_blue_contract`
    /// or `set_green_contract`) before calling this function.
    ///
    /// Emits a `("lumenflow", "blue_green_cutover")` event with the new slot.
    pub fn set_active_slot(env: Env, admin: Address, slot: Slot) {
        admin.require_auth();
        Self::require_admin(&env, &admin);

        // Verify the target slot is configured before committing the cutover.
        match slot {
            Slot::Blue => {
                assert!(
                    env.storage().instance().has(&RouterKey::BlueContract),
                    "blue contract not configured — call set_blue_contract first"
                );
            }
            Slot::Green => {
                assert!(
                    env.storage().instance().has(&RouterKey::GreenContract),
                    "green contract not configured — call set_green_contract first"
                );
            }
        }

        env.storage()
            .instance()
            .set(&RouterKey::ActiveSlot, &slot);

        env.events().publish(
            (
                Symbol::new(&env, "lumenflow"),
                Symbol::new(&env, "blue_green_cutover"),
            ),
            slot,
        );
    }

    // ── Canary configuration setters (admin-only) ─────────────────────────

    /// Register the stable LumenFlow contract address (canary strategy).
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
    /// - `weight = 0`   → canary disabled, all traffic to active/stable slot
    /// - `weight = 5`   → 5% to canary, 95% to active/stable (default for evaluation)
    /// - `weight = 100` → 100% to canary (full shift before promotion)
    ///
    /// When the canary weight is 0, blue-green routing applies. When
    /// non-zero, the canary weight takes precedence and routes a fraction
    /// of calls to the canary contract regardless of the active slot.
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
    /// ## Decision tree
    ///
    /// ```text
    /// canary_weight = storage[CANARY_WEIGHT]  (default: 0)
    ///
    /// if canary_weight > 0:
    ///   bucket = ledger_sequence mod 100
    ///   if bucket < canary_weight  →  return canary contract
    ///   else                       →  return stable contract
    /// else (blue-green mode):
    ///   active_slot = storage[ACTIVE_SLOT]  (default: Blue)
    ///   if active_slot == Blue   →  return blue contract
    ///   if active_slot == Green  →  return green contract
    /// ```
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
            .unwrap_or(0u32);

        let ledger_seq: u32 = env.ledger().sequence();

        if canary_weight > 0 {
            // ── Canary routing mode ──────────────────────────────────────
            let bucket: u32 = ledger_seq % 100;
            if bucket < canary_weight {
                let canary: Address = env
                    .storage()
                    .instance()
                    .get(&RouterKey::CanaryContract)
                    .expect("canary contract not configured — call set_canary_contract first");

                env.events().publish(
                    (
                        Symbol::new(&env, "lumenflow"),
                        Symbol::new(&env, "routed_to_canary"),
                    ),
                    ledger_seq,
                );
                return canary;
            } else {
                let stable: Address = env
                    .storage()
                    .instance()
                    .get(&RouterKey::StableContract)
                    .expect("stable contract not configured — call set_stable_contract first");

                env.events().publish(
                    (
                        Symbol::new(&env, "lumenflow"),
                        Symbol::new(&env, "routed_to_stable"),
                    ),
                    ledger_seq,
                );
                return stable;
            }
        }

        // ── Blue-green routing mode ──────────────────────────────────────
        let active_slot: Slot = env
            .storage()
            .instance()
            .get(&RouterKey::ActiveSlot)
            .unwrap_or(Slot::Blue); // default: blue is active

        match active_slot {
            Slot::Blue => {
                let blue: Address = env
                    .storage()
                    .instance()
                    .get(&RouterKey::BlueContract)
                    .expect("blue contract not configured — call set_blue_contract first");

                env.events().publish(
                    (
                        Symbol::new(&env, "lumenflow"),
                        Symbol::new(&env, "routed_to_blue"),
                    ),
                    ledger_seq,
                );
                blue
            }
            Slot::Green => {
                let green: Address = env
                    .storage()
                    .instance()
                    .get(&RouterKey::GreenContract)
                    .expect("green contract not configured — call set_green_contract first");

                env.events().publish(
                    (
                        Symbol::new(&env, "lumenflow"),
                        Symbol::new(&env, "routed_to_green"),
                    ),
                    ledger_seq,
                );
                green
            }
        }
    }

    // ── Read-only helpers ─────────────────────────────────────────────────

    /// Return the currently active blue-green slot (`Blue` or `Green`).
    /// Returns `Blue` if no active slot has been set yet.
    pub fn get_active_slot(env: Env) -> Slot {
        env.storage()
            .instance()
            .get(&RouterKey::ActiveSlot)
            .unwrap_or(Slot::Blue)
    }

    /// Return the blue-slot contract address, if configured.
    pub fn get_blue_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&RouterKey::BlueContract)
    }

    /// Return the green-slot contract address, if configured.
    pub fn get_green_contract(env: Env) -> Option<Address> {
        env.storage().instance().get(&RouterKey::GreenContract)
    }

    /// Return the currently configured canary weight (percentage).
    /// Returns `0` (disabled) if not set.
    pub fn get_canary_weight(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&RouterKey::CanaryWeight)
            .unwrap_or(0u32)
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
        assert!(*caller == admin, "caller is not the router admin");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    fn setup() -> (Env, RouterContractClient<'static>, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(RouterContract, ());
        let client = RouterContractClient::new(&env, &contract_id);
        let admin = Address::generate(&env);
        client.set_admin(&admin);
        (env, client, admin)
    }

    // ── Blue-green tests ──────────────────────────────────────────────────

    #[test]
    fn test_blue_green_default_routes_to_blue() {
        let (env, client, admin) = setup();
        let blue = Address::generate(&env);
        let green = Address::generate(&env);
        client.set_blue_contract(&admin, &blue);
        client.set_green_contract(&admin, &green);
        // Default active slot is Blue
        assert_eq!(client.get_active_slot(), Slot::Blue);
        assert_eq!(client.route_call(), blue);
    }

    #[test]
    fn test_set_active_slot_green_routes_to_green() {
        let (env, client, admin) = setup();
        let blue = Address::generate(&env);
        let green = Address::generate(&env);
        client.set_blue_contract(&admin, &blue);
        client.set_green_contract(&admin, &green);
        client.set_active_slot(&admin, &Slot::Green);
        assert_eq!(client.get_active_slot(), Slot::Green);
        assert_eq!(client.route_call(), green);
    }

    #[test]
    fn test_cutover_is_atomic_and_reversible() {
        let (env, client, admin) = setup();
        let blue = Address::generate(&env);
        let green = Address::generate(&env);
        client.set_blue_contract(&admin, &blue);
        client.set_green_contract(&admin, &green);

        // Start on blue
        assert_eq!(client.route_call(), blue);

        // Cutover to green
        client.set_active_slot(&admin, &Slot::Green);
        assert_eq!(client.route_call(), green);

        // Rollback to blue
        client.set_active_slot(&admin, &Slot::Blue);
        assert_eq!(client.route_call(), blue);
    }

    #[test]
    #[should_panic(expected = "green contract not configured")]
    fn test_set_active_slot_panics_if_slot_not_configured() {
        let (env, client, admin) = setup();
        // No green contract set — must panic
        client.set_active_slot(&admin, &Slot::Green);
    }

    #[test]
    fn test_get_blue_and_green_contract() {
        let (env, client, admin) = setup();
        let blue = Address::generate(&env);
        let green = Address::generate(&env);
        client.set_blue_contract(&admin, &blue);
        client.set_green_contract(&admin, &green);
        assert_eq!(client.get_blue_contract(), Some(blue));
        assert_eq!(client.get_green_contract(), Some(green));
    }

    // ── Canary tests ──────────────────────────────────────────────────────

    #[test]
    fn test_canary_weight_zero_disables_canary_routing() {
        let (env, client, admin) = setup();
        let blue = Address::generate(&env);
        client.set_blue_contract(&admin, &blue);
        client.set_canary_weight(&admin, &0);
        assert_eq!(client.get_canary_weight(), 0);
        // Should use blue-green routing (blue is active)
        assert_eq!(client.route_call(), blue);
    }

    #[test]
    fn test_canary_routing_weight_100_always_routes_to_canary() {
        let (env, client, admin) = setup();
        let stable = Address::generate(&env);
        let canary = Address::generate(&env);
        client.set_stable_contract(&admin, &stable);
        client.set_canary_contract(&admin, &canary);
        client.set_canary_weight(&admin, &100);
        // Any ledger seq mod 100 < 100, so always canary
        assert_eq!(client.route_call(), canary);
    }

    #[test]
    fn test_canary_routing_weight_0_always_routes_to_stable_via_canary_path() {
        let (env, client, admin) = setup();
        let blue = Address::generate(&env);
        let stable = Address::generate(&env);
        let canary = Address::generate(&env);
        client.set_blue_contract(&admin, &blue);
        client.set_stable_contract(&admin, &stable);
        client.set_canary_contract(&admin, &canary);
        client.set_canary_weight(&admin, &0);
        // canary_weight == 0 → blue-green routing → blue
        assert_eq!(client.route_call(), blue);
    }

    #[test]
    #[should_panic(expected = "weight must be in range 0–100")]
    fn test_canary_weight_above_100_panics() {
        let (env, client, admin) = setup();
        client.set_canary_weight(&admin, &101);
    }

    // ── Admin tests ───────────────────────────────────────────────────────

    #[test]
    fn test_set_admin_and_require_admin() {
        let (env, client, admin) = setup();
        assert_eq!(
            env.storage()
                .instance()
                .get::<RouterKey, Address>(&RouterKey::Admin),
            Some(admin)
        );
    }

    #[test]
    #[should_panic(expected = "caller is not the router admin")]
    fn test_non_admin_cannot_set_blue_contract() {
        let (env, client, _admin) = setup();
        let impostor = Address::generate(&env);
        let blue = Address::generate(&env);
        // impostor is not the admin — must panic
        client.set_blue_contract(&impostor, &blue);
    }
}
