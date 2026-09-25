/// Property-based tests for refund invariants.
///
/// These tests use `proptest` to generate arbitrary sequences of partial refund
/// amounts and verify that the invariants defined in `invariant_refund.rs` hold
/// in all cases.
///
/// Run with:
///   cargo test --all-features prop_
///
/// The tests also exercise the contract itself via the Soroban testutils
/// harness to confirm that the contract enforces these invariants end-to-end.
#[cfg(test)]
mod prop_refund_tests {
    use proptest::prelude::*;
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Bytes, Env, String as SorobanString, Vec as SorobanVec,
    };

    use crate::{
        error::PaymentError,
        invariant_refund::{
            all_refunds_positive, cumulative_refunds_within_original, remaining_refundable,
            refund_total_is_order_independent,
        },
        types::MerchantCategory,
        PaymentProcessingContract, PaymentProcessingContractClient,
    };

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn setup_env() -> (Env, PaymentProcessingContractClient<'static>, Address, Address, Address, Address) {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(PaymentProcessingContract, ());
        let client = PaymentProcessingContractClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let merchant = Address::generate(&env);
        let payer = Address::generate(&env);
        let token_admin = Address::generate(&env);

        // Register the SAC token
        let token = env.register_stellar_asset_contract_v2(token_admin.clone()).address();

        client.set_admin(&admin);
        client.add_allowed_token(&admin, &token);
        client.register_merchant(
            &merchant,
            &SorobanString::from_str(&env, "PropTest Shop"),
            &SorobanString::from_str(&env, ""),
            &SorobanString::from_str(&env, ""),
            &MerchantCategory::Retail,
        );

        StellarAssetClient::new(&env, &token).mint(&payer, &1_000_000_000);

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
        let pub_key = Bytes::from_slice(env, &[0u8; 32]);
        let sig = Bytes::from_slice(env, &[0u8; 64]);
        client.process_payment_with_signature(
            payer,
            &SorobanString::from_str(env, order_id),
            merchant,
            token,
            &amount,
            &SorobanString::from_str(env, "prop test payment"),
            &None,
            &sig,
            &pub_key,
        );
    }

    // ── Pure invariant property tests ─────────────────────────────────────────

    proptest! {
        /// Invariant: cumulative executed refunds never exceed the original amount,
        /// when each partial amount is drawn from [1, original_amount/n].
        #[test]
        fn prop_cumulative_refunds_within_original(
            original in 1_i128..1_000_000_i128,
            // Generate 0–10 refund amounts, each in [1, original]
            refunds in proptest::collection::vec(1_i128..=original, 0..=10_usize),
        ) {
            // Sum the refunds but cap each prefix so the total can't exceed original
            let mut remaining = original;
            let mut executed: std::vec::Vec<i128> = std::vec::Vec::new();
            for r in &refunds {
                let actual = (*r).min(remaining);
                if actual <= 0 { break; }
                executed.push(actual);
                remaining -= actual;
                if remaining == 0 { break; }
            }

            prop_assert!(cumulative_refunds_within_original(original, &executed));
            prop_assert!(all_refunds_positive(&executed) || executed.is_empty());
            prop_assert!(remaining_refundable(original, &executed).is_some());
        }

        /// Invariant: refund total is order-independent (commutative).
        #[test]
        fn prop_refund_total_order_independent(
            amounts in proptest::collection::vec(1_i128..=10_000_i128, 0..=10_usize),
        ) {
            let mut reversed = amounts.clone();
            reversed.reverse();

            prop_assert_eq!(
                refund_total_is_order_independent(&amounts),
                refund_total_is_order_independent(&reversed),
            );
        }

        /// Invariant: remaining refundable amount is always non-negative when
        /// each partial refund is at most the remaining balance.
        #[test]
        fn prop_remaining_always_non_negative(
            original in 1_i128..1_000_000_i128,
            refund_fractions in proptest::collection::vec(1_u32..=100_u32, 0..=10_usize),
        ) {
            let mut remaining = original;
            let mut executed: std::vec::Vec<i128> = std::vec::Vec::new();
            for frac in &refund_fractions {
                // Take frac% of whatever is left
                let amount = (remaining * (*frac as i128) / 100).max(1).min(remaining);
                if amount == 0 { break; }
                executed.push(amount);
                remaining -= amount;
                if remaining == 0 { break; }
            }

            prop_assert!(remaining_refundable(original, &executed).is_some());
            let leftover = remaining_refundable(original, &executed).unwrap();
            prop_assert!(leftover >= 0);
            prop_assert_eq!(leftover, original - executed.iter().sum::<i128>());
        }
    }

    // ── Contract integration property tests ──────────────────────────────────

    proptest! {
        /// Contract invariant: executing a sequence of partial refunds (each
        /// within the remaining balance) never makes refunded_amount exceed amount.
        #[test]
        fn prop_contract_refunds_within_original(
            // Original payment between 1000 and 100_000 stroops
            original in 1_000_i128..=100_000_i128,
            // 1–5 partial refund fractions expressed as percentages of original
            fractions in proptest::collection::vec(1_u32..=99_u32, 1..=5_usize),
        ) {
            let (env, client, _admin, merchant, payer, token) = setup_env();
            make_payment(&env, &client, &merchant, &payer, &token, "PROP_ORDER_1", original);

            let mut remaining = original;
            let mut seq: u32 = 0;

            for frac in &fractions {
                let amount = (remaining * (*frac as i128) / 100).max(1).min(remaining);
                if amount <= 0 || remaining <= 0 { break; }

                let refund_id = std::format!("PROP_RF_{}", seq);
                seq += 1;

                let rid = SorobanString::from_str(&env, &refund_id);
                let oid = SorobanString::from_str(&env, "PROP_ORDER_1");

                let res = client.try_initiate_refund(
                    &payer,
                    &rid,
                    &oid,
                    &amount,
                    &SorobanString::from_str(&env, "prop partial refund"),
                );

                // Only execute refunds that pass initiation
                if res.is_ok() {
                    client.approve_refund(&merchant, &rid);
                    client.execute_refund(&rid);
                    remaining -= amount;
                }
            }

            let payment = client.get_payment_by_id(&payer, &SorobanString::from_str(&env, "PROP_ORDER_1"));
            prop_assert!(payment.refunded_amount >= 0);
            prop_assert!(payment.refunded_amount <= payment.amount);
        }

        /// Contract invariant: refund window is always respected — a refund
        /// initiated more than 30 days after payment must be rejected.
        #[test]
        fn prop_contract_refund_window_respected(
            // Days past the payment — test both inside and outside the window
            days_after in 0_u64..=60_u64,
        ) {
            let (env, client, _admin, merchant, payer, token) = setup_env();
            make_payment(&env, &client, &merchant, &payer, &token, "PROP_WINDOW", 1_000);

            // Advance ledger time
            env.ledger().with_mut(|l| {
                l.timestamp += days_after * 24 * 3600;
            });

            let result = client.try_initiate_refund(
                &payer,
                &SorobanString::from_str(&env, "PROP_RF_WINDOW"),
                &SorobanString::from_str(&env, "PROP_WINDOW"),
                &100,
                &SorobanString::from_str(&env, "window test"),
            );

            if days_after <= 30 {
                // Within the 30-day window — must succeed (or fail for other reasons, but not window)
                if let Err(Ok(err)) = result {
                    prop_assert_ne!(err, PaymentError::RefundWindowExpired);
                }
            } else {
                // Outside the window — must be rejected
                prop_assert_eq!(result, Err(Ok(PaymentError::RefundWindowExpired)));
            }
        }
    }
}
