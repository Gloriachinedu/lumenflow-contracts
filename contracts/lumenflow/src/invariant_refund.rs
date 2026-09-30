/// Invariant tests for refund and payout state transitions.
///
/// These tests assert that the state machine governing refund and payout
/// lifecycles is sound.  Each test encodes a *contract invariant* — a property
/// that must hold true regardless of the order or combination of valid inputs.
///
/// ## Invariants verified
///
/// ### Refund state machine
/// - A new refund always starts in `Pending`.
/// - `Pending` → `Approved` requires a merchant-or-admin caller.
/// - `Pending` → `Rejected` requires a merchant-or-admin caller.
/// - Once `Approved`, further `approve_refund` calls are rejected.
/// - Once `Rejected`, further `reject_refund` calls are rejected.
/// - `execute_refund` on a `Pending` refund returns `RefundNotApproved`.
/// - `execute_refund` on a `Rejected` refund returns `RefundNotApproved`.
/// - `execute_refund` on an `Approved` refund transitions it to `Completed`.
/// - A `Completed` refund cannot be executed again.
///
/// ### Payout / payment status transitions
/// - A processed payment always starts as `Completed` (no refund yet).
/// - After a partial refund execution the status becomes `PartiallyRefunded`.
/// - After a full refund execution the status becomes `FullyRefunded`.
/// - Cumulative refunded amount never exceeds the original payment amount.
///
/// ### Boundary / illegal transitions
/// - Initiating a refund beyond the 30-day window is rejected.
/// - Initiating a refund when cumulative refunds would exceed the original
///   amount is rejected.
/// - Duplicate refund IDs are rejected.
#[cfg(test)]
mod invariant_refund_state_tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Bytes, Env, String,
    };

    use crate::{
        error::PaymentError,
        types::{MerchantCategory, RefundStatus, PaymentStatus},
        PaymentProcessingContract, PaymentProcessingContractClient,
    };

    // ── Test helpers ──────────────────────────────────────────────────────────

    fn setup() -> (Env, PaymentProcessingContractClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let id = env.register(PaymentProcessingContract, ());
        let client = PaymentProcessingContractClient::new(&env, &id);
        (env, client)
    }

    fn str(env: &Env, s: &str) -> String {
        String::from_str(env, s)
    }

    fn bytes32(env: &Env) -> Bytes {
        Bytes::from_slice(env, &[0u8; 32])
    }

    fn bytes64(env: &Env) -> Bytes {
        Bytes::from_slice(env, &[0u8; 64])
    }

    fn create_token(env: &Env, admin: &Address) -> Address {
        env.register_stellar_asset_contract_v2(admin.clone()).address()
    }

    fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
        StellarAssetClient::new(env, token).mint(to, &amount);
    }

    /// Full environment: admin, allowed token, registered merchant, funded payer.
    fn full_setup() -> (
        Env,
        PaymentProcessingContractClient<'static>,
        Address, // admin
        Address, // merchant
        Address, // payer
        Address, // token
    ) {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        let merchant = Address::generate(&env);
        let payer = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token = create_token(&env, &token_admin);

        client.set_admin(&admin);
        client.add_allowed_token(&admin, &token);
        client.register_merchant(
            &merchant,
            &str(&env, "InvShop"),
            &str(&env, "invariant test merchant"),
            &str(&env, "contact"),
            &MerchantCategory::Retail,
        );
        // Fund both payer (for payments) and merchant (for executing refunds).
        mint(&env, &token, &payer, 10_000_000);
        mint(&env, &token, &merchant, 10_000_000);
        (env, client, admin, merchant, payer, token)
    }

    fn make_payment(
        env: &Env,
        client: &PaymentProcessingContractClient,
        merchant: &Address,
        payer: &Address,
        token: &Address,
        order_id: &str,
        amount: i128,
    ) {
        client.process_payment_with_signature(
            payer,
            &str(env, order_id),
            merchant,
            token,
            &amount,
            &str(env, ""),
            &None,
            &bytes64(env),
            &bytes32(env),
        );
    }

    fn make_refund(
        env: &Env,
        client: &PaymentProcessingContractClient,
        payer: &Address,
        order_id: &str,
        refund_id: &str,
        amount: i128,
    ) {
        client.initiate_refund(
            payer,
            &str(env, refund_id),
            &str(env, order_id),
            &amount,
            &str(env, "test reason"),
        );
    }

    // ── Invariant 1: new refund always starts as Pending ──────────────────────

    #[test]
    fn inv_new_refund_is_pending() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I1", 1_000);
        make_refund(&env, &client, &payer, "ORD_I1", "REF_I1", 100);

        let r = client.get_refund(&str(&env, "REF_I1"));
        assert!(
            matches!(r.status, RefundStatus::Pending),
            "newly initiated refund must be Pending"
        );
    }

    // ── Invariant 2: Pending → Approved ──────────────────────────────────────

    #[test]
    fn inv_pending_to_approved_by_merchant() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I2", 1_000);
        make_refund(&env, &client, &payer, "ORD_I2", "REF_I2", 100);

        client.approve_refund(&merchant, &str(&env, "REF_I2"));
        let r = client.get_refund(&str(&env, "REF_I2"));
        assert!(matches!(r.status, RefundStatus::Approved));
    }

    #[test]
    fn inv_pending_to_approved_by_admin() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I3", 1_000);
        make_refund(&env, &client, &payer, "ORD_I3", "REF_I3", 100);

        client.approve_refund(&admin, &str(&env, "REF_I3"));
        let r = client.get_refund(&str(&env, "REF_I3"));
        assert!(matches!(r.status, RefundStatus::Approved));
    }

    // ── Invariant 3: Pending → Rejected ──────────────────────────────────────

    #[test]
    fn inv_pending_to_rejected_by_merchant() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I4", 1_000);
        make_refund(&env, &client, &payer, "ORD_I4", "REF_I4", 100);

        client.reject_refund(&merchant, &str(&env, "REF_I4"));
        let r = client.get_refund(&str(&env, "REF_I4"));
        assert!(matches!(r.status, RefundStatus::Rejected));
    }

    // ── Invariant 4: Approved is terminal for approve/reject ─────────────────

    #[test]
    fn inv_approved_cannot_be_re_approved() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I5", 1_000);
        make_refund(&env, &client, &payer, "ORD_I5", "REF_I5", 100);

        client.approve_refund(&merchant, &str(&env, "REF_I5"));
        let res = client.try_approve_refund(&merchant, &str(&env, "REF_I5"));
        assert_eq!(
            res,
            Err(Ok(PaymentError::RefundAlreadyCompleted)),
            "re-approving an already-approved refund must fail"
        );
    }

    #[test]
    fn inv_approved_cannot_be_rejected() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I6", 1_000);
        make_refund(&env, &client, &payer, "ORD_I6", "REF_I6", 100);

        client.approve_refund(&merchant, &str(&env, "REF_I6"));
        let res = client.try_reject_refund(&merchant, &str(&env, "REF_I6"));
        assert_eq!(
            res,
            Err(Ok(PaymentError::RefundAlreadyCompleted)),
            "rejecting an already-approved refund must fail"
        );
    }

    // ── Invariant 5: Rejected is terminal for approve/reject ─────────────────

    #[test]
    fn inv_rejected_cannot_be_approved() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I7", 1_000);
        make_refund(&env, &client, &payer, "ORD_I7", "REF_I7", 100);

        client.reject_refund(&merchant, &str(&env, "REF_I7"));
        let res = client.try_approve_refund(&merchant, &str(&env, "REF_I7"));
        assert_eq!(
            res,
            Err(Ok(PaymentError::RefundAlreadyCompleted)),
            "approving a rejected refund must fail"
        );
    }

    #[test]
    fn inv_rejected_cannot_be_re_rejected() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I8", 1_000);
        make_refund(&env, &client, &payer, "ORD_I8", "REF_I8", 100);

        client.reject_refund(&merchant, &str(&env, "REF_I8"));
        let res = client.try_reject_refund(&merchant, &str(&env, "REF_I8"));
        assert_eq!(res, Err(Ok(PaymentError::RefundAlreadyCompleted)));
    }

    // ── Invariant 6: execute_refund requires Approved status ─────────────────

    #[test]
    fn inv_execute_pending_refund_fails() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I9", 1_000);
        make_refund(&env, &client, &payer, "ORD_I9", "REF_I9", 100);

        // Pending — not yet approved.
        let res = client.try_execute_refund(&str(&env, "REF_I9"));
        assert_eq!(
            res,
            Err(Ok(PaymentError::RefundNotApproved)),
            "executing a Pending refund must fail"
        );
    }

    #[test]
    fn inv_execute_rejected_refund_fails() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I10", 1_000);
        make_refund(&env, &client, &payer, "ORD_I10", "REF_I10", 100);

        client.reject_refund(&merchant, &str(&env, "REF_I10"));
        let res = client.try_execute_refund(&str(&env, "REF_I10"));
        assert_eq!(
            res,
            Err(Ok(PaymentError::RefundNotApproved)),
            "executing a Rejected refund must fail"
        );
    }

    // ── Invariant 7: Approved → Completed via execute ────────────────────────

    #[test]
    fn inv_approved_to_completed_via_execute() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I11", 1_000);
        make_refund(&env, &client, &payer, "ORD_I11", "REF_I11", 200);

        client.approve_refund(&merchant, &str(&env, "REF_I11"));
        client.execute_refund(&str(&env, "REF_I11"));

        let r = client.get_refund(&str(&env, "REF_I11"));
        assert!(
            matches!(r.status, RefundStatus::Completed),
            "executed refund must be Completed"
        );
    }

    // ── Invariant 8: Completed refund cannot be executed again ───────────────

    #[test]
    fn inv_completed_refund_cannot_be_re_executed() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I12", 1_000);
        make_refund(&env, &client, &payer, "ORD_I12", "REF_I12", 100);

        client.approve_refund(&merchant, &str(&env, "REF_I12"));
        client.execute_refund(&str(&env, "REF_I12"));

        let res = client.try_execute_refund(&str(&env, "REF_I12"));
        assert_eq!(
            res,
            Err(Ok(PaymentError::RefundNotApproved)),
            "re-executing a Completed refund must fail"
        );
    }

    // ── Invariant 9: payment starts as Completed (no refund) ─────────────────

    #[test]
    fn inv_payment_initial_status_is_completed() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I13", 500);
        let p = client.get_payment_by_id(&payer, &str(&env, "ORD_I13"));
        assert!(matches!(p.status, PaymentStatus::Completed));
        assert_eq!(p.refunded_amount, 0);
    }

    // ── Invariant 10: partial refund → PartiallyRefunded ─────────────────────

    #[test]
    fn inv_partial_refund_sets_partially_refunded_status() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I14", 1_000);
        make_refund(&env, &client, &payer, "ORD_I14", "REF_I14", 300);

        client.approve_refund(&merchant, &str(&env, "REF_I14"));
        client.execute_refund(&str(&env, "REF_I14"));

        let p = client.get_payment_by_id(&payer, &str(&env, "ORD_I14"));
        assert!(
            matches!(p.status, PaymentStatus::PartiallyRefunded),
            "payment with partial refund must be PartiallyRefunded"
        );
        assert_eq!(p.refunded_amount, 300);
    }

    // ── Invariant 11: full refund → FullyRefunded ─────────────────────────────

    #[test]
    fn inv_full_refund_sets_fully_refunded_status() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I15", 1_000);
        make_refund(&env, &client, &payer, "ORD_I15", "REF_I15", 1_000);

        client.approve_refund(&merchant, &str(&env, "REF_I15"));
        client.execute_refund(&str(&env, "REF_I15"));

        let p = client.get_payment_by_id(&payer, &str(&env, "ORD_I15"));
        assert!(
            matches!(p.status, PaymentStatus::FullyRefunded),
            "payment fully refunded must be FullyRefunded"
        );
        assert_eq!(p.refunded_amount, 1_000);
    }

    // ── Invariant 12: cumulative refunds never exceed original amount ─────────

    #[test]
    fn inv_cumulative_refund_cannot_exceed_original_amount() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I16", 500);

        // First partial refund is fine.
        make_refund(&env, &client, &payer, "ORD_I16", "REF_I16a", 300);

        // Second refund that would push the total over 500 must be rejected.
        let res = client.try_initiate_refund(
            &payer,
            &str(&env, "REF_I16b"),
            &str(&env, "ORD_I16"),
            &300, // 300 + 300 = 600 > 500
            &str(&env, "overflow attempt"),
        );
        assert_eq!(
            res,
            Err(Ok(PaymentError::RefundExceedsOriginal)),
            "refund that exceeds original payment amount must be rejected"
        );
    }

    // ── Invariant 13: refund window expiry ────────────────────────────────────

    #[test]
    fn inv_refund_after_window_is_rejected() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I17", 1_000);

        // Advance ledger time beyond the 30-day refund window.
        env.ledger().with_mut(|l| {
            l.timestamp += 31 * 24 * 3600; // 31 days
        });

        let res = client.try_initiate_refund(
            &payer,
            &str(&env, "REF_I17"),
            &str(&env, "ORD_I17"),
            &100,
            &str(&env, "late request"),
        );
        assert_eq!(
            res,
            Err(Ok(PaymentError::RefundWindowExpired)),
            "refund initiated after 30-day window must be rejected"
        );
    }

    // ── Invariant 14: refund window boundary (just inside) ────────────────────

    #[test]
    fn inv_refund_at_window_boundary_succeeds() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I18", 1_000);

        // Advance to exactly 30 days — still within window.
        env.ledger().with_mut(|l| {
            l.timestamp += 30 * 24 * 3600;
        });

        // Should succeed (timestamp == paid_at + REFUND_WINDOW_SECS is still valid).
        make_refund(&env, &client, &payer, "ORD_I18", "REF_I18", 100);
        let r = client.get_refund(&str(&env, "REF_I18"));
        assert!(matches!(r.status, RefundStatus::Pending));
    }

    // ── Invariant 15: duplicate refund ID rejected ────────────────────────────

    #[test]
    fn inv_duplicate_refund_id_rejected() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_I19", 1_000);
        make_refund(&env, &client, &payer, "ORD_I19", "REF_I19", 100);

        let res = client.try_initiate_refund(
            &payer,
            &str(&env, "REF_I19"), // same refund ID
            &str(&env, "ORD_I19"),
            &50,
            &str(&env, "duplicate"),
        );
        assert_eq!(
            res,
            Err(Ok(PaymentError::RefundAlreadyExists)),
            "duplicate refund ID must be rejected"
        );
    }

    // ── Invariant 16: complete lifecycle — full round-trip ────────────────────

    #[test]
    fn inv_full_refund_lifecycle() {
        let (env, client, _admin, merchant, payer, token) = full_setup();

        // Step 1: payment processed
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_FULL", 2_000);
        let p = client.get_payment_by_id(&payer, &str(&env, "ORD_FULL"));
        assert!(matches!(p.status, PaymentStatus::Completed));

        // Step 2: refund initiated → Pending
        make_refund(&env, &client, &payer, "ORD_FULL", "REF_FULL", 2_000);
        let r = client.get_refund(&str(&env, "REF_FULL"));
        assert!(matches!(r.status, RefundStatus::Pending));

        // Step 3: refund approved → Approved
        client.approve_refund(&merchant, &str(&env, "REF_FULL"));
        let r = client.get_refund(&str(&env, "REF_FULL"));
        assert!(matches!(r.status, RefundStatus::Approved));

        // Step 4: refund executed → Completed; payment → FullyRefunded
        client.execute_refund(&str(&env, "REF_FULL"));
        let r = client.get_refund(&str(&env, "REF_FULL"));
        assert!(matches!(r.status, RefundStatus::Completed));

        let p = client.get_payment_by_id(&payer, &str(&env, "ORD_FULL"));
        assert!(matches!(p.status, PaymentStatus::FullyRefunded));
        assert_eq!(p.refunded_amount, 2_000);
    }

    // ── Invariant 17: global stats track executed refunds ────────────────────

    #[test]
    fn inv_global_stats_updated_after_refund_execution() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ORD_G1", 1_000);
        make_refund(&env, &client, &payer, "ORD_G1", "REF_G1", 400);
        client.approve_refund(&merchant, &str(&env, "REF_G1"));
        client.execute_refund(&str(&env, "REF_G1"));

        let stats = client.get_global_payment_stats(&admin, &None, &None);
        assert!(stats.total_refunds >= 1, "total_refunds must increment");
        assert!(stats.total_refund_volume >= 400, "total_refund_volume must include refund amount");
    }
}
