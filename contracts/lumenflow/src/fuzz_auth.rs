/// Fuzz-style authorization tests for every privileged contract entry point.
///
/// These tests exercise authorization checks by driving each privileged function
/// with:
///   1. A valid admin/caller (happy path — must succeed).
///   2. A random non-admin address (must return `Unauthorized`).
///   3. Boundary cases such as an uninitialised admin, wrong role caller, etc.
///
/// Because Soroban's test environment is deterministic we simulate "fuzz" variety
/// by parameterising over a fixed set of distinct address identities and asserting
/// that only the correct identity is accepted.  A property-based fuzzer (e.g.
/// `cargo-fuzz` + `libFuzzer`) can be layered on top of these helpers in the
/// future once WASM fuzzing support matures.
#[cfg(test)]
mod fuzz_auth_tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Bytes, Env, String, Vec,
    };

    use crate::{
        error::PaymentError,
        types::MerchantCategory,
        PaymentProcessingContract, PaymentProcessingContractClient,
    };

    // ── Helpers ───────────────────────────────────────────────────────────────

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

    /// Bootstrap a fully-initialised environment: admin set, token allowed,
    /// merchant registered, payer funded.
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
            &str(&env, "FuzzShop"),
            &str(&env, "desc"),
            &str(&env, "contact"),
            &MerchantCategory::Retail,
        );
        mint(&env, &token, &payer, 1_000_000);
        (env, client, admin, merchant, payer, token)
    }

    // ── set_admin ─────────────────────────────────────────────────────────────

    /// Admin can only be set once; a second call from any address must fail.
    #[test]
    fn fuzz_set_admin_already_set() {
        let (env, client) = setup();
        let admin = Address::generate(&env);
        client.set_admin(&admin);

        // Any subsequent call — even by the same admin — must fail.
        for _ in 0..3 {
            let attacker = Address::generate(&env);
            let res = client.try_set_admin(&attacker);
            assert_eq!(res, Err(Ok(PaymentError::AdminAlreadySet)));
        }
    }

    /// A contract address must be rejected as admin.
    #[test]
    fn fuzz_set_admin_contract_address_rejected() {
        let (env, client) = setup();
        let contract_addr = env.register(PaymentProcessingContract, ());
        let res = client.try_set_admin(&contract_addr);
        assert_eq!(res, Err(Ok(PaymentError::InvalidAdminAddress)));
    }

    // ── set_payment_cleanup_period ────────────────────────────────────────────

    /// Non-admin callers must be rejected.
    #[test]
    fn fuzz_set_payment_cleanup_period_unauthorized() {
        let (env, client, _admin, merchant, payer, _token) = full_setup();

        for non_admin in [&merchant, &payer] {
            let res = client.try_set_payment_cleanup_period(non_admin, &86_400);
            assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
        }
    }

    /// Admin succeeds.
    #[test]
    fn fuzz_set_payment_cleanup_period_admin_succeeds() {
        let (env, client, admin, ..) = full_setup();
        client.set_payment_cleanup_period(&admin, &(7 * 24 * 3600));
    }

    // ── set_large_payment_threshold ───────────────────────────────────────────

    #[test]
    fn fuzz_set_large_payment_threshold_unauthorized() {
        let (env, client, _admin, merchant, payer, _token) = full_setup();

        for non_admin in [&merchant, &payer] {
            let res = client.try_set_large_payment_threshold(non_admin, &50_000);
            assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
        }
    }

    #[test]
    fn fuzz_set_large_payment_threshold_invalid_amount() {
        let (env, client, admin, ..) = full_setup();
        // Zero and negative values must be rejected.
        assert_eq!(
            client.try_set_large_payment_threshold(&admin, &0),
            Err(Ok(PaymentError::InvalidAmount))
        );
        assert_eq!(
            client.try_set_large_payment_threshold(&admin, &-1),
            Err(Ok(PaymentError::InvalidAmount))
        );
    }

    #[test]
    fn fuzz_set_large_payment_threshold_admin_succeeds() {
        let (env, client, admin, ..) = full_setup();
        client.set_large_payment_threshold(&admin, &100_000);
    }

    // ── set_max_refunds_per_order ─────────────────────────────────────────────

    #[test]
    fn fuzz_set_max_refunds_per_order_unauthorized() {
        let (env, client, _admin, merchant, payer, _token) = full_setup();

        for non_admin in [&merchant, &payer] {
            let res = client.try_set_max_refunds_per_order(non_admin, &3);
            assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
        }
    }

    #[test]
    fn fuzz_set_max_refunds_per_order_admin_succeeds() {
        let (env, client, admin, ..) = full_setup();
        client.set_max_refunds_per_order(&admin, &10);
    }

    // ── deactivate_merchant ───────────────────────────────────────────────────

    #[test]
    fn fuzz_deactivate_merchant_unauthorized() {
        let (env, client, _admin, merchant, payer, _token) = full_setup();

        for non_admin in [&merchant, &payer] {
            let res = client.try_deactivate_merchant(non_admin, &merchant);
            assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
        }
    }

    #[test]
    fn fuzz_deactivate_merchant_nonexistent() {
        let (env, client, admin, ..) = full_setup();
        let ghost = Address::generate(&env);
        let res = client.try_deactivate_merchant(&admin, &ghost);
        assert_eq!(res, Err(Ok(PaymentError::MerchantNotFound)));
    }

    #[test]
    fn fuzz_deactivate_merchant_admin_succeeds() {
        let (env, client, admin, merchant, ..) = full_setup();
        client.deactivate_merchant(&admin, &merchant);
        let m = client.get_merchant(&merchant);
        assert!(!m.active);
    }

    // ── verify_merchant / unverify_merchant ───────────────────────────────────

    #[test]
    fn fuzz_verify_merchant_unauthorized() {
        let (env, client, _admin, merchant, payer, _token) = full_setup();

        for non_admin in [&merchant, &payer] {
            let res = client.try_verify_merchant(non_admin, &merchant);
            assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
        }
    }

    #[test]
    fn fuzz_verify_merchant_admin_succeeds() {
        let (env, client, admin, merchant, ..) = full_setup();
        client.verify_merchant(&admin, &merchant);
        assert!(client.get_merchant(&merchant).verified);
    }

    #[test]
    fn fuzz_unverify_merchant_unauthorized() {
        let (env, client, admin, merchant, payer, _token) = full_setup();
        client.verify_merchant(&admin, &merchant);

        let res = client.try_unverify_merchant(&payer, &merchant);
        assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
    }

    #[test]
    fn fuzz_unverify_merchant_admin_succeeds() {
        let (env, client, admin, merchant, ..) = full_setup();
        client.verify_merchant(&admin, &merchant);
        client.unverify_merchant(&admin, &merchant);
        assert!(!client.get_merchant(&merchant).verified);
    }

    // ── archive_payment_record ────────────────────────────────────────────────

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

    #[test]
    fn fuzz_archive_payment_record_unauthorized() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ARC_01", 100);

        for non_admin in [&merchant, &payer] {
            let res = client.try_archive_payment_record(non_admin, &str(&env, "ARC_01"));
            assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
        }
    }

    #[test]
    fn fuzz_archive_payment_record_nonexistent() {
        let (env, client, admin, ..) = full_setup();
        let res = client.try_archive_payment_record(&admin, &str(&env, "GHOST_ORDER"));
        assert_eq!(res, Err(Ok(PaymentError::PaymentNotFound)));
    }

    #[test]
    fn fuzz_archive_payment_record_admin_succeeds() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "ARC_OK", 200);
        client.archive_payment_record(&admin, &str(&env, "ARC_OK"));
    }

    // ── cleanup_expired_payments ──────────────────────────────────────────────

    #[test]
    fn fuzz_cleanup_expired_payments_unauthorized() {
        let (env, client, _admin, merchant, payer, _token) = full_setup();

        for non_admin in [&merchant, &payer] {
            let res = client.try_cleanup_expired_payments(non_admin);
            assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
        }
    }

    #[test]
    fn fuzz_cleanup_expired_payments_admin_succeeds() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        client.set_payment_cleanup_period(&admin, &(30 * 24 * 3600));
        make_payment(&env, &client, &merchant, &payer, &token, "OLD_01", 100);
        // Advance time beyond the cleanup period.
        env.ledger().with_mut(|l| {
            l.timestamp += 31 * 24 * 3600;
        });
        let removed = client.cleanup_expired_payments(&admin);
        assert!(removed >= 1, "expected at least one expired payment to be removed");
    }

    // ── get_global_payment_stats ──────────────────────────────────────────────

    #[test]
    fn fuzz_get_global_payment_stats_unauthorized() {
        let (env, client, _admin, merchant, payer, _token) = full_setup();

        for non_admin in [&merchant, &payer] {
            let res = client.try_get_global_payment_stats(non_admin, &None, &None);
            assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
        }
    }

    #[test]
    fn fuzz_get_global_payment_stats_admin_succeeds() {
        let (env, client, admin, ..) = full_setup();
        let stats = client.get_global_payment_stats(&admin, &None, &None);
        // At least the one merchant registered in full_setup() counts.
        assert!(stats.active_merchants >= 1);
    }

    // ── approve_refund / reject_refund ────────────────────────────────────────

    fn make_refund(
        env: &Env,
        client: &PaymentProcessingContractClient,
        merchant: &Address,
        payer: &Address,
        token: &Address,
        order_id: &str,
        refund_id: &str,
        amount: i128,
    ) {
        make_payment(env, client, merchant, payer, token, order_id, amount * 2);
        client.initiate_refund(
            payer,
            &str(env, refund_id),
            &str(env, order_id),
            &amount,
            &str(env, "fuzz reason"),
        );
    }

    #[test]
    fn fuzz_approve_refund_unauthorized() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_refund(&env, &client, &merchant, &payer, &token, "O_AR1", "R_AR1", 50);

        // Payer (initiator) must NOT be able to self-approve.
        let res = client.try_approve_refund(&payer, &str(&env, "R_AR1"));
        assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
    }

    #[test]
    fn fuzz_approve_refund_merchant_succeeds() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_refund(&env, &client, &merchant, &payer, &token, "O_AM2", "R_AM2", 50);
        client.approve_refund(&merchant, &str(&env, "R_AM2"));
        let r = client.get_refund(&str(&env, "R_AM2"));
        assert!(matches!(r.status, crate::types::RefundStatus::Approved));
    }

    #[test]
    fn fuzz_approve_refund_admin_succeeds() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        make_refund(&env, &client, &merchant, &payer, &token, "O_AA3", "R_AA3", 50);
        client.approve_refund(&admin, &str(&env, "R_AA3"));
        let r = client.get_refund(&str(&env, "R_AA3"));
        assert!(matches!(r.status, crate::types::RefundStatus::Approved));
    }

    #[test]
    fn fuzz_approve_refund_already_approved_fails() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_refund(&env, &client, &merchant, &payer, &token, "O_DA4", "R_DA4", 50);
        client.approve_refund(&merchant, &str(&env, "R_DA4"));
        // Second approve must fail.
        let res = client.try_approve_refund(&merchant, &str(&env, "R_DA4"));
        assert_eq!(res, Err(Ok(PaymentError::RefundAlreadyCompleted)));
    }

    #[test]
    fn fuzz_reject_refund_unauthorized() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_refund(&env, &client, &merchant, &payer, &token, "O_RR5", "R_RR5", 50);

        let res = client.try_reject_refund(&payer, &str(&env, "R_RR5"));
        assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
    }

    #[test]
    fn fuzz_reject_refund_merchant_succeeds() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_refund(&env, &client, &merchant, &payer, &token, "O_RM6", "R_RM6", 50);
        client.reject_refund(&merchant, &str(&env, "R_RM6"));
        let r = client.get_refund(&str(&env, "R_RM6"));
        assert!(matches!(r.status, crate::types::RefundStatus::Rejected));
    }

    #[test]
    fn fuzz_reject_refund_already_rejected_fails() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_refund(&env, &client, &merchant, &payer, &token, "O_DJ7", "R_DJ7", 50);
        client.reject_refund(&merchant, &str(&env, "R_DJ7"));
        let res = client.try_reject_refund(&merchant, &str(&env, "R_DJ7"));
        assert_eq!(res, Err(Ok(PaymentError::RefundAlreadyCompleted)));
    }

    // ── update_payment_status ─────────────────────────────────────────────────

    #[test]
    fn fuzz_update_payment_status_unauthorized() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "UPS_01", 300);

        // A random third party must be rejected.
        let stranger = Address::generate(&env);
        let res = client.try_update_payment_status(
            &stranger,
            &str(&env, "UPS_01"),
            &100,
        );
        assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
    }

    #[test]
    fn fuzz_update_payment_status_admin_succeeds() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "UPS_02", 300);
        client.update_payment_status(&admin, &str(&env, "UPS_02"), &100);
    }

    #[test]
    fn fuzz_update_payment_status_merchant_succeeds() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "UPS_03", 300);
        client.update_payment_status(&merchant, &str(&env, "UPS_03"), &50);
    }

    // ── Cross-role boundary: merchant cannot call admin-only endpoints ─────────

    #[test]
    fn fuzz_merchant_cannot_call_admin_only_endpoints() {
        let (env, client, _admin, merchant, _payer, _token) = full_setup();

        let new_merchant = Address::generate(&env);

        // deactivate_merchant
        assert_eq!(
            client.try_deactivate_merchant(&merchant, &new_merchant),
            Err(Ok(PaymentError::Unauthorized))
        );
        // set_payment_cleanup_period
        assert_eq!(
            client.try_set_payment_cleanup_period(&merchant, &3600),
            Err(Ok(PaymentError::Unauthorized))
        );
        // set_large_payment_threshold
        assert_eq!(
            client.try_set_large_payment_threshold(&merchant, &9999),
            Err(Ok(PaymentError::Unauthorized))
        );
        // get_global_payment_stats
        assert_eq!(
            client.try_get_global_payment_stats(&merchant, &None, &None),
            Err(Ok(PaymentError::Unauthorized))
        );
        // cleanup_expired_payments
        assert_eq!(
            client.try_cleanup_expired_payments(&merchant),
            Err(Ok(PaymentError::Unauthorized))
        );
    }

    // ── Cross-role boundary: payer cannot call merchant-or-admin endpoints ────

    #[test]
    fn fuzz_payer_cannot_call_merchant_or_admin_endpoints() {
        let (env, client, _admin, merchant, payer, token) = full_setup();
        make_payment(&env, &client, &merchant, &payer, &token, "CROSS_01", 500);
        client.initiate_refund(
            &payer,
            &str(&env, "CROSS_REF_01"),
            &str(&env, "CROSS_01"),
            &100,
            &str(&env, "reason"),
        );

        // Payer cannot approve their own refund.
        assert_eq!(
            client.try_approve_refund(&payer, &str(&env, "CROSS_REF_01")),
            Err(Ok(PaymentError::Unauthorized))
        );
        // Payer cannot reject either.
        assert_eq!(
            client.try_reject_refund(&payer, &str(&env, "CROSS_REF_01")),
            Err(Ok(PaymentError::Unauthorized))
        );
        // Payer cannot archive payments.
        assert_eq!(
            client.try_archive_payment_record(&payer, &str(&env, "CROSS_01")),
            Err(Ok(PaymentError::Unauthorized))
        );
    }
}
