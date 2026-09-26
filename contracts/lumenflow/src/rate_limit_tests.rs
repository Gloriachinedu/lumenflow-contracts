/// Tests for per-merchant API rate limits on the payment endpoint.
///
/// The rate limit is a tumbling window: a merchant may receive at most
/// `payment_rate_limit` payments within any `payment_rate_window` second
/// interval.  When the window expires the counter resets automatically.
///
/// Defaults (when admin has not configured anything):
///   - limit  : 100 payments per window
///   - window : 3600 seconds (1 hour)
///
/// Both values are configurable by the admin via `set_payment_rate_limit`
/// and `set_payment_rate_window`.
#[cfg(test)]
mod rate_limit_tests {
    use soroban_sdk::{
        testutils::{Address as _, Ledger},
        token::StellarAssetClient,
        Address, Bytes, Env, String,
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
            &str(&env, "RateShop"),
            &str(&env, "rate limit test merchant"),
            &str(&env, "contact"),
            &MerchantCategory::Retail,
        );
        mint(&env, &token, &payer, 100_000_000);
        (env, client, admin, merchant, payer, token)
    }

    fn pay(
        env: &Env,
        client: &PaymentProcessingContractClient,
        payer: &Address,
        merchant: &Address,
        token: &Address,
        order_id: &str,
    ) -> Result<(), PaymentError> {
        client.try_process_payment_with_signature(
            payer,
            &str(env, order_id),
            merchant,
            token,
            &100,
            &str(env, ""),
            &None,
            &bytes64(env),
            &bytes32(env),
        ).map_err(|e| e.unwrap())
    }

    // ── set_payment_rate_limit ────────────────────────────────────────────────

    #[test]
    fn test_set_rate_limit_admin_only() {
        let (env, client, _admin, merchant, payer, _token) = full_setup();

        for non_admin in [&merchant, &payer] {
            let res = client.try_set_payment_rate_limit(non_admin, &10);
            assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
        }
    }

    #[test]
    fn test_set_rate_limit_zero_rejected() {
        let (env, client, admin, ..) = full_setup();
        let res = client.try_set_payment_rate_limit(&admin, &0);
        assert_eq!(res, Err(Ok(PaymentError::InvalidInput)));
    }

    #[test]
    fn test_set_rate_limit_admin_succeeds() {
        let (env, client, admin, ..) = full_setup();
        client.set_payment_rate_limit(&admin, &50);
    }

    // ── set_payment_rate_window ───────────────────────────────────────────────

    #[test]
    fn test_set_rate_window_admin_only() {
        let (env, client, _admin, merchant, payer, _token) = full_setup();

        for non_admin in [&merchant, &payer] {
            let res = client.try_set_payment_rate_window(non_admin, &3600);
            assert_eq!(res, Err(Ok(PaymentError::Unauthorized)));
        }
    }

    #[test]
    fn test_set_rate_window_zero_rejected() {
        let (env, client, admin, ..) = full_setup();
        let res = client.try_set_payment_rate_window(&admin, &0);
        assert_eq!(res, Err(Ok(PaymentError::InvalidInput)));
    }

    #[test]
    fn test_set_rate_window_admin_succeeds() {
        let (env, client, admin, ..) = full_setup();
        client.set_payment_rate_window(&admin, &1800);
    }

    // ── Rate limit enforcement ────────────────────────────────────────────────

    /// Happy path: payments within the limit all succeed.
    #[test]
    fn test_payments_within_limit_succeed() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        // Allow 3 payments per 1-hour window.
        client.set_payment_rate_limit(&admin, &3);
        client.set_payment_rate_window(&admin, &3600);

        for i in 0..3u32 {
            let order_id = alloc::format!("RL_OK_{i}");
            assert!(
                pay(&env, &client, &payer, &merchant, &token, &order_id).is_ok(),
                "payment {i} within limit must succeed"
            );
        }
    }

    /// The (limit + 1)-th payment within the same window must be rejected.
    #[test]
    fn test_payment_exceeding_limit_rejected() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        client.set_payment_rate_limit(&admin, &3);
        client.set_payment_rate_window(&admin, &3600);

        for i in 0..3u32 {
            let order_id = alloc::format!("RL_LIM_{i}");
            pay(&env, &client, &payer, &merchant, &token, &order_id).unwrap();
        }

        // 4th payment — over the limit.
        let result = pay(&env, &client, &payer, &merchant, &token, "RL_LIM_OVER");
        assert_eq!(
            result,
            Err(PaymentError::RateLimitExceeded),
            "payment exceeding rate limit must return RateLimitExceeded"
        );
    }

    /// After the window expires the counter resets and payments are accepted again.
    #[test]
    fn test_rate_limit_resets_after_window_expires() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        client.set_payment_rate_limit(&admin, &2);
        client.set_payment_rate_window(&admin, &3600);

        // Fill the window.
        pay(&env, &client, &payer, &merchant, &token, "RL_WIN_0").unwrap();
        pay(&env, &client, &payer, &merchant, &token, "RL_WIN_1").unwrap();

        // Over limit.
        assert_eq!(
            pay(&env, &client, &payer, &merchant, &token, "RL_WIN_OVER"),
            Err(PaymentError::RateLimitExceeded)
        );

        // Advance time beyond the window.
        env.ledger().with_mut(|l| {
            l.timestamp += 3601; // 1 second past the window
        });

        // Counter should have reset — new payment succeeds.
        assert!(
            pay(&env, &client, &payer, &merchant, &token, "RL_WIN_NEW").is_ok(),
            "payment after window expiry must succeed"
        );
    }

    /// Rate limit is per merchant — different merchants have independent counters.
    #[test]
    fn test_rate_limit_is_per_merchant() {
        let (env, client, admin, merchant1, payer, token) = full_setup();
        // Register a second merchant.
        let merchant2 = Address::generate(&env);
        client.register_merchant(
            &merchant2,
            &str(&env, "RateShop2"),
            &str(&env, "second merchant"),
            &str(&env, ""),
            &MerchantCategory::Retail,
        );

        client.set_payment_rate_limit(&admin, &1);
        client.set_payment_rate_window(&admin, &3600);

        // First merchant fills their quota.
        pay(&env, &client, &payer, &merchant1, &token, "RL_PM_M1_0").unwrap();
        assert_eq!(
            pay(&env, &client, &payer, &merchant1, &token, "RL_PM_M1_OVER"),
            Err(PaymentError::RateLimitExceeded),
            "merchant1 should be rate-limited"
        );

        // Second merchant has its own independent counter — payment must succeed.
        assert!(
            pay(&env, &client, &payer, &merchant2, &token, "RL_PM_M2_0").is_ok(),
            "merchant2 should not be affected by merchant1's rate limit"
        );
    }

    /// Boundary: exactly at the limit (not over) must succeed.
    #[test]
    fn test_payment_at_exact_limit_succeeds() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        client.set_payment_rate_limit(&admin, &5);
        client.set_payment_rate_window(&admin, &3600);

        for i in 0..5u32 {
            let order_id = alloc::format!("RL_EXACT_{i}");
            assert!(
                pay(&env, &client, &payer, &merchant, &token, &order_id).is_ok(),
                "payment at exact limit boundary must succeed"
            );
        }
    }

    /// After window reset, counter starts fresh (not cumulative across windows).
    #[test]
    fn test_multiple_window_resets() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        client.set_payment_rate_limit(&admin, &2);
        client.set_payment_rate_window(&admin, &600); // 10 minutes

        for window in 0..3u32 {
            // Fill the window for each of 3 consecutive windows.
            for slot in 0..2u32 {
                let order_id = alloc::format!("RL_MULTI_W{window}_S{slot}");
                assert!(
                    pay(&env, &client, &payer, &merchant, &token, &order_id).is_ok(),
                    "window {window} slot {slot} must succeed"
                );
            }
            // Advance to the next window.
            env.ledger().with_mut(|l| {
                l.timestamp += 601;
            });
        }
    }

    /// Limit of 1 means exactly one payment per window.
    #[test]
    fn test_rate_limit_of_one() {
        let (env, client, admin, merchant, payer, token) = full_setup();
        client.set_payment_rate_limit(&admin, &1);
        client.set_payment_rate_window(&admin, &3600);

        pay(&env, &client, &payer, &merchant, &token, "RL_ONE_OK").unwrap();
        assert_eq!(
            pay(&env, &client, &payer, &merchant, &token, "RL_ONE_FAIL"),
            Err(PaymentError::RateLimitExceeded)
        );
    }
}

// Required for alloc::format! in #![no_std] test modules.
extern crate alloc;
