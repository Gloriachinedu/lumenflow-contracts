/// Storage size benchmark tests for LumenFlow contract types.
///
/// Soroban enforces a per-entry size limit on persistent storage. These tests
/// serialize representative instances of the major storage structs using the
/// Soroban SDK environment and assert that the byte count stays within defined
/// thresholds. CI fails automatically when any struct grows beyond its limit.
///
/// Thresholds are documented in docs/storage-schema.md.
///
/// Run:
///   cargo test storage_size --package lumenflow -- --nocapture
#[cfg(test)]
mod storage_size_tests {
    use soroban_sdk::{
        testutils::Address as _,
        xdr::{ScVal, ToXdr},
        Address, Bytes, Env, IntoVal, String, Vec,
    };

    use crate::types::{
        MerchantCategory, Merchant, MultisigPayment, PaymentOrder, PaymentStatus,
    };

    // ── Thresholds (bytes) ───────────────────────────────────────────────────
    //
    // These values match the limits documented in docs/storage-schema.md.
    // Tighten them when you want an earlier warning of struct growth.

    /// Maximum serialised size for a Merchant record.
    const MERCHANT_SIZE_LIMIT: usize = 512;

    /// Maximum serialised size for a PaymentOrder record.
    const PAYMENT_ORDER_SIZE_LIMIT: usize = 1024; // 1 KB

    /// Maximum serialised size for a MultisigPayment record.
    const MULTISIG_PAYMENT_SIZE_LIMIT: usize = 2048; // 2 KB

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// Serialise a Soroban `Val` into XDR bytes and return the byte count.
    fn serialised_size<T: IntoVal<Env, soroban_sdk::Val>>(env: &Env, value: T) -> usize {
        let sc_val: ScVal = value.into_val(env).try_into().unwrap();
        sc_val.to_xdr(soroban_sdk::xdr::Limits::none()).unwrap().len()
    }

    /// Build a Merchant with maximally-sized string fields to measure a
    /// realistic worst-case byte footprint.
    fn worst_case_merchant(env: &Env) -> Merchant {
        Merchant {
            address: Address::generate(env),
            // Strings use realistic maximum lengths for each field
            name: String::from_str(env, &"A".repeat(64)),
            description: String::from_str(env, &"D".repeat(128)),
            contact_info: String::from_str(env, &"C".repeat(64)),
            category: MerchantCategory::Services,
            active: true,
            verified: true,
            registered_at: u64::MAX,
            total_received: i128::MAX,
        }
    }

    /// Build a PaymentOrder with realistic maximum field lengths, including
    /// optional fields set to their most space-consuming values.
    fn worst_case_payment_order(env: &Env) -> PaymentOrder {
        let mut tags = Vec::new(env);
        for i in 0..4u32 {
            tags.push_back(String::from_str(env, &format!("tag-{i:032}")));
        }

        PaymentOrder {
            order_id: String::from_str(env, &"O".repeat(64)),
            merchant_address: Address::generate(env),
            payer: Address::generate(env),
            token: Address::generate(env),
            amount: i128::MAX,
            status: PaymentStatus::PartiallyRefunded,
            paid_at: u64::MAX,
            refunded_amount: i128::MAX,
            memo: String::from_str(env, &"M".repeat(128)),
            tags: Some(tags),
            note: Some(String::from_str(env, &"N".repeat(128))),
        }
    }

    /// Build a MultisigPayment with the maximum number of allowed signers (10)
    /// each contributing a 64-byte signature.
    fn worst_case_multisig_payment(env: &Env) -> MultisigPayment {
        const MAX_SIGNERS: usize = 10;

        let mut signers = Vec::new(env);
        let mut signatures = Vec::new(env);
        let mut signed_by = Vec::new(env);

        for _ in 0..MAX_SIGNERS {
            let addr = Address::generate(env);
            signers.push_back(addr.clone());
            signatures.push_back(Bytes::from_slice(env, &[0xABu8; 64]));
            signed_by.push_back(addr);
        }

        MultisigPayment {
            payment_id: String::from_str(env, &"P".repeat(64)),
            merchant_address: Address::generate(env),
            token: Address::generate(env),
            amount: i128::MAX,
            required_signatures: MAX_SIGNERS as u32,
            signers,
            signatures,
            signed_by,
            executed: true,
            created_at: u64::MAX,
        }
    }

    // ── Tests ─────────────────────────────────────────────────────────────────

    /// Merchant records must stay below 512 bytes when serialised.
    ///
    /// Threshold: MERCHANT_SIZE_LIMIT (512 bytes)
    #[test]
    fn test_merchant_storage_size() {
        let env = Env::default();
        let merchant = worst_case_merchant(&env);
        let size = serialised_size(&env, merchant);

        println!(
            "[storage_size] Merchant: {} bytes (limit: {} bytes)",
            size, MERCHANT_SIZE_LIMIT
        );

        assert!(
            size <= MERCHANT_SIZE_LIMIT,
            "Merchant struct ({size} bytes) exceeds the {MERCHANT_SIZE_LIMIT}-byte storage limit. \
             Review recent field additions and update docs/storage-schema.md."
        );
    }

    /// PaymentOrder records must stay below 1 KB when serialised.
    ///
    /// Threshold: PAYMENT_ORDER_SIZE_LIMIT (1024 bytes)
    #[test]
    fn test_payment_order_storage_size() {
        let env = Env::default();
        let order = worst_case_payment_order(&env);
        let size = serialised_size(&env, order);

        println!(
            "[storage_size] PaymentOrder: {} bytes (limit: {} bytes)",
            size, PAYMENT_ORDER_SIZE_LIMIT
        );

        assert!(
            size <= PAYMENT_ORDER_SIZE_LIMIT,
            "PaymentOrder struct ({size} bytes) exceeds the {PAYMENT_ORDER_SIZE_LIMIT}-byte storage limit. \
             Review recent field additions and update docs/storage-schema.md."
        );
    }

    /// MultisigPayment records must stay below 2 KB when serialised.
    ///
    /// Threshold: MULTISIG_PAYMENT_SIZE_LIMIT (2048 bytes)
    #[test]
    fn test_multisig_payment_storage_size() {
        let env = Env::default();
        let payment = worst_case_multisig_payment(&env);
        let size = serialised_size(&env, payment);

        println!(
            "[storage_size] MultisigPayment: {} bytes (limit: {} bytes)",
            size, MULTISIG_PAYMENT_SIZE_LIMIT
        );

        assert!(
            size <= MULTISIG_PAYMENT_SIZE_LIMIT,
            "MultisigPayment struct ({size} bytes) exceeds the {MULTISIG_PAYMENT_SIZE_LIMIT}-byte storage limit. \
             Review recent field additions and update docs/storage-schema.md."
        );
    }
}
