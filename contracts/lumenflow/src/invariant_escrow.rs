/// Invariant tests for escrow balance conservation.
///
/// These tests assert that token balances are conserved across all payment and
/// refund operations.  Every token that leaves the payer's wallet must arrive
/// at the merchant's wallet and vice-versa; no tokens may be created or
/// destroyed by contract operations.
///
/// ## Core conservation law
///
///   payer_balance_before + merchant_balance_before
///       == payer_balance_after + merchant_balance_after
///
/// In other words, the sum of balances over all participants is constant.
///
/// ## Invariants verified
///
/// 1. Payment: payer decreases by `amount`, merchant increases by `amount`.
/// 2. Partial refund execution: merchant decreases by `refund_amount`, payer
///    increases by `refund_amount`.
/// 3. Full refund execution: full conservation after a 100% refund.
/// 4. Multiple sequential partial refunds conserve balances cumulatively.
/// 5. Zero-sum across a batch payment to multiple merchants.
/// 6. Rejected refund: no balance change occurs.
/// 7. Unapproved refund (Pending): no balance change when only initiated.
/// 8. Global stats `total_volume` matches the sum of all payment amounts.
/// 9. Global stats `total_refund_volume` matches the sum of all executed refund amounts.
/// 10. Merchant `total_received` field reflects accumulated payment amounts.
#[cfg(test)]
mod invariant_escrow_tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::{Client as TokenClient, StellarAssetClient},
        Address, Bytes, Env, String, Vec,
    };

    use crate::{
        error::PaymentError,
        types::{BatchPaymentItem, MerchantCategory},
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

    fn balance(env: &Env, token: &Address, account: &Address) -> i128 {
        TokenClient::new(env, token).balance(account)
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
            &str(&env, "EscrowShop"),
            &str(&env, "escrow test merchant"),
            &str(&env, "contact"),
            &MerchantCategory::Retail,
        );
        // Fund both sides: payer for outgoing payments, merchant for refund
        // executions.
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
            &str(env, "conservation test"),
        );
    }

    // ── Invariant 1: payment conserves balances ───────────────────────────────

    #[test]
    fn inv_payment_conserves_balances() {
        let (env, client, _admin, merchant, payer, token) = full_setup();

        let payer_before = balance(&env, &token, &payer);
        let merchant_before = balance(&env, &token, &merchant);
        let amount: i128 = 1_500;

        make_payment(&env, &client, &merchant, &payer, &token, "E_ORD01", amount);

        let payer_after = balance(&env, &token, &payer);
        let merchant_after = balance(&env, &token, &merchant);

        assert_eq!(
            payer_after,
            payer_before - amount,
            "payer balance must decrease by payment amount"
        );
        assert_eq!(
            merchant_after,
            merchant_before + amount,
            "merchant balance must increase by payment amount"
        );
        // Conservation: sum is constant.
        assert_eq!(
            payer_before + merchant_before,
            payer_after + merchant_after,
            "total balance must be conserved across payment"
        );
    }

    // ── Invariant 2: partial refund conserves balances ────────────────────────

    #[test]
    fn inv_partial_refund_conserves_balances() {
        let (env, client, _admin, merchant, payer, token) = full_setup();

        let amount: i128 = 2_000;
        let refund_amount: i128 = 600;

        make_payment(&env, &client, &merchant, &payer, &token, "E_ORD02", amount);

        let payer_before_refund = balance(&env, &token, &payer);
        let merchant_before_refund = balance(&env, &token, &merchant);

        make_refund(&env, &client, &payer, "E_ORD02", "E_REF02", refund_amount);
        client.approve_refund(&merchant, &str(&env, "E_REF02"));
        client.execute_refund(&str(&env, "E_REF02"));

        let payer_after = balance(&env, &token, &payer);
        let merchant_after = balance(&env, &token, &merchant);

        assert_eq!(
            payer_after,
            payer_before_refund + refund_amount,
            "payer balance must increase by refund amount after execute"
        );
        assert_eq!(
            merchant_after,
            merchant_before_refund - refund_amount,
            "merchant balance must decrease by refund amount after execute"
        );
        assert_eq!(
            payer_before_refund + merchant_before_refund,
            payer_after + merchant_after,
            "total balance conserved across refund execution"
        );
    }

    // ── Invariant 3: full refund returns exact payment amount ────────────────

    #[test]
    fn inv_full_refund_restores_payer_balance() {
        let (env, client, _admin, merchant, payer, token) = full_setup();

        let payer_initial = balance(&env, &token, &payer);
        let merchant_initial = balance(&env, &token, &merchant);
        let amount: i128 = 3_000;

        make_payment(&env, &client, &merchant, &payer, &token, "E_ORD03", amount);
        make_refund(&env, &client, &payer, "E_ORD03", "E_REF03", amount);
        client.approve_refund(&merchant, &str(&env, "E_REF03"));
        client.execute_refund(&str(&env, "E_REF03"));

        let payer_final = balance(&env, &token, &payer);
        let merchant_final = balance(&env, &token, &merchant);

        assert_eq!(
            payer_final, payer_initial,
            "payer balance must be fully restored after full refund"
        );
        assert_eq!(
            merchant_final, merchant_initial,
            "merchant balance must be fully restored after full refund"
        );
    }

    // ── Invariant 4: multiple partial refunds conserve balances cumulatively ──

    #[test]
    fn inv_multiple_partial_refunds_conserve_balances() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        // Increase refund cap to allow multiple refunds on same order.
        client.set_max_refunds_per_order(&admin, &10);

        let amount: i128 = 5_000;
        make_payment(&env, &client, &merchant, &payer, &token, "E_ORD04", amount);

        let payer_start = balance(&env, &token, &payer);
        let merchant_start = balance(&env, &token, &merchant);

        let refunds = [("E_REF04a", 500i128), ("E_REF04b", 1_000), ("E_REF04c", 750)];
        let mut total_refunded: i128 = 0;

        for (ref_id, ref_amount) in refunds {
            make_refund(&env, &client, &payer, "E_ORD04", ref_id, ref_amount);
            client.approve_refund(&merchant, &str(&env, ref_id));
            client.execute_refund(&str(&env, ref_id));
            total_refunded += ref_amount;
        }

        let payer_end = balance(&env, &token, &payer);
        let merchant_end = balance(&env, &token, &merchant);

        assert_eq!(
            payer_end,
            payer_start + total_refunded,
            "payer balance must increase by total refunded"
        );
        assert_eq!(
            merchant_end,
            merchant_start - total_refunded,
            "merchant balance must decrease by total refunded"
        );
        assert_eq!(
            payer_start + merchant_start,
            payer_end + merchant_end,
            "total balance conserved across all refunds"
        );
    }

    // ── Invariant 5: rejected refund causes no balance change ────────────────

    #[test]
    fn inv_rejected_refund_no_balance_change() {
        let (env, client, _admin, merchant, payer, token) = full_setup();

        make_payment(&env, &client, &merchant, &payer, &token, "E_ORD05", 1_000);

        let payer_before = balance(&env, &token, &payer);
        let merchant_before = balance(&env, &token, &merchant);

        make_refund(&env, &client, &payer, "E_ORD05", "E_REF05", 400);
        client.reject_refund(&merchant, &str(&env, "E_REF05"));

        assert_eq!(
            balance(&env, &token, &payer),
            payer_before,
            "payer balance unchanged after rejected refund"
        );
        assert_eq!(
            balance(&env, &token, &merchant),
            merchant_before,
            "merchant balance unchanged after rejected refund"
        );
    }

    // ── Invariant 6: pending (unapproved) refund causes no balance change ─────

    #[test]
    fn inv_pending_refund_no_balance_change() {
        let (env, client, _admin, merchant, payer, token) = full_setup();

        make_payment(&env, &client, &merchant, &payer, &token, "E_ORD06", 1_000);

        let payer_before = balance(&env, &token, &payer);
        let merchant_before = balance(&env, &token, &merchant);

        // Only initiate — do not approve or execute.
        make_refund(&env, &client, &payer, "E_ORD06", "E_REF06", 200);

        assert_eq!(
            balance(&env, &token, &payer),
            payer_before,
            "payer balance unchanged after initiation only"
        );
        assert_eq!(
            balance(&env, &token, &merchant),
            merchant_before,
            "merchant balance unchanged after initiation only"
        );
    }

    // ── Invariant 7: batch payment conserves balances (zero-sum) ─────────────

    #[test]
    fn inv_batch_payment_conserves_balances() {
        let (env, client, admin, _default_merchant, payer, token) = full_setup();

        // Create two additional merchants for the batch.
        let m1 = Address::generate(&env);
        let m2 = Address::generate(&env);
        client.register_merchant(&m1, &str(&env, "M1"), &str(&env, ""), &str(&env, ""), &MerchantCategory::Retail);
        client.register_merchant(&m2, &str(&env, "M2"), &str(&env, ""), &str(&env, ""), &MerchantCategory::Retail);

        let amount1: i128 = 800;
        let amount2: i128 = 1_200;
        let total = amount1 + amount2;

        let payer_before = balance(&env, &token, &payer);
        let m1_before = balance(&env, &token, &m1);
        let m2_before = balance(&env, &token, &m2);

        let mut batch = Vec::new(&env);
        batch.push_back(BatchPaymentItem {
            order_id: str(&env, "BATCH_E1"),
            merchant_address: m1.clone(),
            token_address: token.clone(),
            amount: amount1,
            memo: str(&env, ""),
            signature: bytes64(&env),
            merchant_public_key: bytes32(&env),
        });
        batch.push_back(BatchPaymentItem {
            order_id: str(&env, "BATCH_E2"),
            merchant_address: m2.clone(),
            token_address: token.clone(),
            amount: amount2,
            memo: str(&env, ""),
            signature: bytes64(&env),
            merchant_public_key: bytes32(&env),
        });
        client.batch_payment(&payer, &batch);

        let payer_after = balance(&env, &token, &payer);
        let m1_after = balance(&env, &token, &m1);
        let m2_after = balance(&env, &token, &m2);

        assert_eq!(payer_after, payer_before - total, "payer balance must decrease by total batch amount");
        assert_eq!(m1_after, m1_before + amount1, "m1 balance must increase by its share");
        assert_eq!(m2_after, m2_before + amount2, "m2 balance must increase by its share");
        assert_eq!(
            payer_before + m1_before + m2_before,
            payer_after + m1_after + m2_after,
            "total balance conserved across batch payment"
        );
    }

    // ── Invariant 8: global stats total_volume matches sum of payments ────────

    #[test]
    fn inv_global_stats_volume_matches_payments() {
        let (env, client, admin, merchant, payer, token) = full_setup();

        let amounts = [500i128, 1_200, 300, 750];
        let expected_volume: i128 = amounts.iter().sum();

        for (i, &amount) in amounts.iter().enumerate() {
            let order_id = alloc::format!("GVOL_{i}");
            make_payment(
                &env,
                &client,
                &merchant,
                &payer,
                &token,
                &order_id,
                amount,
            );
        }

        let stats = client.get_global_payment_stats(&admin, &None, &None);
        assert_eq!(
            stats.total_volume, expected_volume,
            "global total_volume must equal the sum of all payment amounts"
        );
        assert_eq!(
            stats.total_payments,
            amounts.len() as u32,
            "total_payments count must match"
        );
    }

    // ── Invariant 9: global stats total_refund_volume matches executed refunds

    #[test]
    fn inv_global_stats_refund_volume_matches_executed() {
        let (env, client, admin, merchant, payer, token) = full_setup();

        let payment_amount: i128 = 10_000;
        make_payment(&env, &client, &merchant, &payer, &token, "GRV_ORD", payment_amount);

        let refund_amounts = [200i128, 300, 500];
        let expected_refund_volume: i128 = refund_amounts.iter().sum();

        for (i, &ref_amount) in refund_amounts.iter().enumerate() {
            let ref_id = alloc::format!("GRV_REF_{i}");
            make_refund(&env, &client, &payer, "GRV_ORD", &ref_id, ref_amount);
            client.approve_refund(&merchant, &str(&env, &ref_id));
            client.execute_refund(&str(&env, &ref_id));
        }

        let stats = client.get_global_payment_stats(&admin, &None, &None);
        assert_eq!(
            stats.total_refund_volume, expected_refund_volume,
            "global total_refund_volume must equal the sum of all executed refund amounts"
        );
        assert_eq!(
            stats.total_refunds,
            refund_amounts.len() as u32,
            "total_refunds count must match executed refunds"
        );
    }

    // ── Invariant 10: merchant total_received reflects accumulated payments ───

    #[test]
    fn inv_merchant_total_received_accumulates() {
        let (env, client, _admin, merchant, payer, token) = full_setup();

        let amounts = [100i128, 200, 400];
        let expected_total: i128 = amounts.iter().sum();

        for (i, &amount) in amounts.iter().enumerate() {
            let order_id = alloc::format!("MTREC_{i}");
            make_payment(&env, &client, &merchant, &payer, &token, &order_id, amount);
        }

        let m = client.get_merchant(&merchant);
        assert_eq!(
            m.total_received, expected_total,
            "merchant total_received must equal the sum of all payment amounts"
        );
    }

    // ── Invariant 11: refunded_amount in payment record tracks executed refunds

    #[test]
    fn inv_payment_refunded_amount_tracks_executed_refunds() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        client.set_max_refunds_per_order(&admin, &10);

        let payment_amount: i128 = 5_000;
        make_payment(&env, &client, &merchant, &payer, &token, "TRACK_ORD", payment_amount);

        let partial_refunds = [300i128, 700, 500];
        let mut cumulative: i128 = 0;

        for (i, &ref_amount) in partial_refunds.iter().enumerate() {
            let ref_id = alloc::format!("TRACK_REF_{i}");
            make_refund(&env, &client, &payer, "TRACK_ORD", &ref_id, ref_amount);
            client.approve_refund(&merchant, &str(&env, &ref_id));
            client.execute_refund(&str(&env, &ref_id));
            cumulative += ref_amount;

            let p = client.get_payment_by_id(&payer, &str(&env, "TRACK_ORD"));
            assert_eq!(
                p.refunded_amount, cumulative,
                "payment refunded_amount must track cumulative executed refunds (step {i})"
            );
        }
    }

    // ── Invariant 12: token transfer integrity — no spurious minting ──────────

    /// Verify that the contract does not create tokens out of thin air.
    /// The total supply (payer + merchant) remains constant throughout the
    /// payment+refund cycle.
    #[test]
    fn inv_no_spurious_minting_across_full_cycle() {
        let (env, client, _admin, merchant, payer, token) = full_setup();

        let initial_total = balance(&env, &token, &payer) + balance(&env, &token, &merchant);
        let payment_amount: i128 = 4_000;
        let refund_amount: i128 = 1_500;

        make_payment(&env, &client, &merchant, &payer, &token, "MINT_ORD", payment_amount);
        make_refund(&env, &client, &payer, "MINT_ORD", "MINT_REF", refund_amount);
        client.approve_refund(&merchant, &str(&env, "MINT_REF"));
        client.execute_refund(&str(&env, "MINT_REF"));

        let final_total = balance(&env, &token, &payer) + balance(&env, &token, &merchant);
        assert_eq!(
            initial_total, final_total,
            "total token supply across participants must not change (no spurious minting)"
        );
    }
}

// Required for alloc::format! in #![no_std] test modules.
extern crate alloc;
