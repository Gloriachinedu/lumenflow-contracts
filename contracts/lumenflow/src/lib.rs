#![no_std]

mod error;
mod helper;
mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, token, Address, Bytes, Env, String, Vec,
    xdr::ToXdr,
};

use error::PaymentError;
use helper::{
    require_admin, require_admin_or, require_non_empty_string, require_positive,
    require_valid_limit, validate_memo_length, validate_tags, verify_signature, REFUND_WINDOW_SECS,
};
use types::{
    BatchPaymentItem, GlobalStats, MerchantCategory, MultisigPayment, PaymentFilter, PaymentOrder,
    PaymentPage, PaymentStatus, RefundRecord, RefundStatus, SortField, SortOrder,
    StatusFilter, Merchant, SuspiciousActivityReason, SubscriptionPlan, Subscription, SubscriptionStatus,
};

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PaymentProcessingContract;

#[contractimpl]
impl PaymentProcessingContract {
    // ── Admin ─────────────────────────────────────────────────────────────────

    /// One-time admin initialisation. Can only be called once; subsequent calls fail.
    ///
    /// # Arguments
    /// * `admin` - The address to designate as the contract administrator.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::AdminAlreadySet`] — an admin has already been configured.
    /// * [`PaymentError::InvalidAdminAddress`] — `admin` is a contract address.
    pub fn set_admin(env: Env, admin: Address) -> Result<(), PaymentError> {
        if storage::get_admin(&env).is_some() {
            return Err(PaymentError::AdminAlreadySet);
        }

        // Prevent setting admin to a contract address or zero address (Issue #83)
        if admin.contract_id().is_some() {
            return Err(PaymentError::InvalidAdminAddress);
        }

        admin.require_auth();
        storage::set_admin(&env, &admin);
        env.events().publish(("lumenflow", "admin_set"), admin);
        Ok(())
    }

    /// Set how long (seconds) before a payment record is eligible for cleanup.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `period` - Minimum age in seconds a payment must reach before it can be removed
    ///   by [`cleanup_expired_payments`].
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    pub fn set_payment_cleanup_period(
        env: Env,
        admin: Address,
        period: u64,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        storage::set_cleanup_period(&env, period);
        env.events().publish(("lumenflow", "cleanup_period_set"), period);
        Ok(())
    }

    /// Set the threshold for unusually large payments (emits suspicious_activity event).
    ///
    /// Payments whose amount is greater than or equal to `threshold` will cause a
    /// `lumenflow/suspicious_activity` event to be emitted.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `threshold` - Minimum amount (inclusive) that triggers the suspicious-activity event.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    /// * [`PaymentError::InvalidAmount`] — `threshold` is not positive.
    pub fn set_large_payment_threshold(
        env: Env,
        admin: Address,
        threshold: i128,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        require_positive(threshold)?;
        storage::set_large_payment_threshold(&env, threshold);
        Ok(())
    }

    /// Set the maximum number of pending refunds allowed per order (default 5). Admin only.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `max` - New maximum number of concurrent pending refunds per order.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    pub fn set_max_refunds_per_order(
        env: Env,
        admin: Address,
        max: u32,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        storage::set_max_refunds_per_order(&env, max);
        Ok(())
    }

    // ── Merchant management ───────────────────────────────────────────────────

    /// Register a new merchant.
    ///
    /// # Arguments
    /// * `merchant_address` - The address of the merchant being registered. Must sign the call.
    /// * `name` - Non-empty display name for the merchant.
    /// * `description` - Free-text description of the merchant's business.
    /// * `contact_info` - Contact details (email, URL, etc.).
    /// * `category` - Business category from [`MerchantCategory`].
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::MerchantAlreadyRegistered`] — the address is already registered.
    /// * [`PaymentError::InvalidInput`] — `name` is empty.
    pub fn register_merchant(
        env: Env,
        merchant_address: Address,
        name: String,
        description: String,
        contact_info: String,
        category: MerchantCategory,
    ) -> Result<(), PaymentError> {
        merchant_address.require_auth();
        require_non_empty_string(&name)?;

        if storage::get_merchant(&env, &merchant_address).is_some() {
            return Err(PaymentError::MerchantAlreadyRegistered);
        }

        let merchant = Merchant {
            address: merchant_address.clone(),
            name,
            description,
            contact_info,
            category,
            active: true,
            verified: false,
            registered_at: env.ledger().timestamp(),
            total_received: 0,
        };

        storage::set_merchant(&env, &merchant);
        storage::add_to_merchant_list(&env, &merchant_address);

        let mut stats = storage::get_global_stats(&env);
        stats.active_merchants += 1;
        storage::set_global_stats(&env, &stats);

        env.events()
            .publish(("lumenflow", "merchant_registered"), merchant_address);
        Ok(())
    }

    /// Deactivate a merchant (admin only).
    ///
    /// Deactivated merchants cannot receive new payments. The global active-merchant
    /// count is decremented (saturating at zero).
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `merchant_address` - Address of the merchant to deactivate.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    /// * [`PaymentError::MerchantNotFound`] — no merchant is registered at `merchant_address`.
    pub fn deactivate_merchant(
        env: Env,
        admin: Address,
        merchant_address: Address,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        let mut merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        merchant.active = false;
        storage::set_merchant(&env, &merchant);

        let mut stats = storage::get_global_stats(&env);
        if stats.active_merchants > 0 {
            stats.active_merchants -= 1;
        }
        storage::set_global_stats(&env, &stats);
        Ok(())
    }

    /// Verify a merchant (admin only).
    ///
    /// Sets the `verified` flag on the merchant profile and emits a
    /// `lumenflow/merchant_verified` event.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `merchant_address` - Address of the merchant to verify.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    /// * [`PaymentError::MerchantNotFound`] — no merchant is registered at `merchant_address`.
    pub fn verify_merchant(
        env: Env,
        admin: Address,
        merchant_address: Address,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        let mut merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        merchant.verified = true;
        storage::set_merchant(&env, &merchant);
        env.events()
            .publish(("lumenflow", "merchant_verified"), merchant_address);
        Ok(())
    }

    /// Remove merchant verification (admin only).
    ///
    /// Clears the `verified` flag on the merchant profile and emits a
    /// `lumenflow/merchant_unverified` event.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `merchant_address` - Address of the merchant to unverify.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    /// * [`PaymentError::MerchantNotFound`] — no merchant is registered at `merchant_address`.
    pub fn unverify_merchant(
        env: Env,
        admin: Address,
        merchant_address: Address,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        let mut merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        merchant.verified = false;
        storage::set_merchant(&env, &merchant);
        env.events()
            .publish(("lumenflow", "merchant_unverified"), merchant_address);
        Ok(())
    }

    /// Get merchant details.
    ///
    /// # Arguments
    /// * `merchant_address` - Address of the merchant to look up.
    ///
    /// # Returns
    /// The [`Merchant`] profile on success.
    ///
    /// # Errors
    /// * [`PaymentError::MerchantNotFound`] — no merchant is registered at `merchant_address`.
    pub fn get_merchant(env: Env, merchant_address: Address) -> Result<Merchant, PaymentError> {
        storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)
    }

    /// Check if a merchant address is already registered.
    ///
    /// # Arguments
    /// * `merchant_address` - Address to check.
    ///
    /// # Returns
    /// `true` if a merchant profile exists for `merchant_address`, `false` otherwise.
    pub fn is_registered(env: Env, merchant_address: Address) -> bool {
        storage::get_merchant(&env, &merchant_address).is_some()
    }


    // ── Payment processing ────────────────────────────────────────────────────

    /// Process a payment with an ed25519 signature from the merchant's key.
    ///
    /// Transfers `amount` tokens from `payer` to `merchant_address` after verifying
    /// the merchant's ed25519 signature over the canonical payload
    /// (`XDR(order_id) || amount_be_i128`). See the inline comment for the exact
    /// byte layout.
    ///
    /// # Arguments
    /// * `payer` - Address funding the payment. Must sign the call.
    /// * `order_id` - Unique, non-empty identifier for this payment.
    /// * `merchant_address` - Registered, active merchant receiving the funds.
    /// * `token_address` - Allowed token contract address.
    /// * `amount` - Positive token amount (in the token's smallest unit).
    /// * `memo` - Optional free-text note; maximum 256 characters.
    /// * `tags` - Optional list of string tags; each tag ≤ 32 characters, max 10 tags.
    /// * `signature` - 64-byte ed25519 signature produced by the merchant's private key.
    /// * `merchant_public_key` - 32-byte ed25519 public key corresponding to the signature.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidAmount`] — `amount` is not positive.
    /// * [`PaymentError::InvalidInput`] — `order_id` is empty, `memo` exceeds 256 chars,
    ///   or tags are invalid.
    /// * [`PaymentError::TokenNotAllowed`] — `token_address` is not on the allow-list.
    /// * [`PaymentError::PaymentAlreadyExists`] — a payment with `order_id` already exists.
    /// * [`PaymentError::MerchantNotFound`] — no merchant registered at `merchant_address`.
    /// * [`PaymentError::MerchantInactive`] — the merchant has been deactivated.
    /// * [`PaymentError::InvalidSignature`] — the ed25519 signature verification failed.
    pub fn process_payment_with_signature(
        env: Env,
        payer: Address,
        order_id: String,
        merchant_address: Address,
        token_address: Address,
        amount: i128,
        memo: String,
        tags: Option<Vec<String>>,
        signature: Bytes,
        merchant_public_key: Bytes,
    ) -> Result<(), PaymentError> {
        payer.require_auth();
        require_positive(amount)?;
        require_non_empty_string(&order_id)?;
        validate_memo_length(&memo)?;
        validate_tags(&tags)?;

        if !storage::is_token_allowed(&env, &token_address) {
            return Err(PaymentError::TokenNotAllowed);
        }

        if storage::get_payment(&env, &order_id).is_some() {
            return Err(PaymentError::PaymentAlreadyExists);
        }

        let merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        if !merchant.active {
            return Err(PaymentError::MerchantInactive);
        }

        // Build signature payload: XDR-encoded order_id followed by big-endian amount.
        //
        // Byte layout:
        //   [0..3]   u32 big-endian — length prefix of the UTF-8 order_id string (XDR String)
        //   [4..4+N) UTF-8 bytes of order_id (N = length prefix value)
        //   [4+N..4+N+P) 0–3 padding bytes so total XDR length is a multiple of 4
        //   [4+N+P..4+N+P+16] i128 big-endian — payment amount (16 bytes)
        //
        // Example — order_id "ORD1" (4 bytes), amount 1000:
        //   00 00 00 04  4F 52 44 31  00 00 00 00 00 00 00 00 00 00 03 E8
        //   ^-- len=4   ^-- "ORD1"   ^-- no padding  ^-- 1000 as i128 BE
        //
        // Off-chain signing (any language):
        //   payload = len_be_u32(order_id) + order_id_utf8 + padding_to_4 + amount_be_i128
        //   signature = ed25519_sign(merchant_private_key, payload)
        let mut payload = Bytes::new(&env);
        payload.append(&order_id.clone().to_xdr(&env));
        payload.append(&Bytes::from_slice(&env, &amount.to_be_bytes()));
        verify_signature(&env, &merchant_public_key, &payload, &signature)?;

        // Transfer tokens from payer to merchant
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&payer, &merchant_address, &amount);

        let now = env.ledger().timestamp();
        let payment = PaymentOrder {
            order_id: order_id.clone(),
            merchant_address: merchant_address.clone(),
            payer: payer.clone(),
            token: token_address,
            amount,
            status: PaymentStatus::Completed,
            paid_at: now,
            refunded_amount: 0,
            memo,
            tags,
            note: None,
        };

        storage::set_payment(&env, &payment);
        storage::add_merchant_payment_id(&env, &merchant_address, &order_id);
        storage::add_payer_payment_id(&env, &payer, &order_id);

        // Update merchant total
        let mut m = merchant;
        m.total_received += amount;
        storage::set_merchant(&env, &m);

        // Update global stats
        let mut stats = storage::get_global_stats(&env);
        stats.total_payments += 1;
            stats.total_volume = stats.total_volume.saturating_add(amount);
        let threshold = storage::get_large_payment_threshold(&env);
        if amount >= threshold {
            env.events().publish(
                ("lumenflow", "suspicious_activity"),
                (SuspiciousActivityReason::LargePayment, payer.clone(), amount),
            );
        }

        env.events().publish(
            ("lumenflow", "payment_processed"),
            (order_id, payer, merchant_address, amount),
        );
        Ok(())
    }

    /// Process a payment with an explicit payer nonce for replay protection.
    ///
    /// The `nonce` must equal the current per-payer nonce stored on-chain. On success
    /// the nonce is incremented, preventing replay of the same call.
    ///
    /// # Arguments
    /// * `payer` - Address funding the payment. Must sign the call.
    /// * `order_id` - Unique, non-empty identifier for this payment.
    /// * `merchant_address` - Registered, active merchant receiving the funds.
    /// * `token_address` - Token contract address (not validated against allow-list here).
    /// * `amount` - Positive token amount.
    /// * `memo` - Optional free-text note.
    /// * `tags` - Optional list of string tags.
    /// * `nonce` - Must match the current on-chain nonce for `payer`.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidAmount`] — `amount` is not positive.
    /// * [`PaymentError::InvalidInput`] — `order_id` is empty or tags are invalid.
    /// * [`PaymentError::InvalidNonce`] — `nonce` does not match the stored payer nonce.
    /// * [`PaymentError::PaymentAlreadyExists`] — a payment with `order_id` already exists.
    /// * [`PaymentError::MerchantNotFound`] — no merchant registered at `merchant_address`.
    /// * [`PaymentError::MerchantInactive`] — the merchant has been deactivated.
    pub fn process_payment_with_nonce(
        env: Env,
        payer: Address,
        order_id: String,
        merchant_address: Address,
        token_address: Address,
        amount: i128,
        memo: String,
        tags: Option<Vec<String>>,
        nonce: u64,
    ) -> Result<(), PaymentError> {
        payer.require_auth();
        require_positive(amount)?;
        require_non_empty_string(&order_id)?;
        validate_tags(&tags)?;

        // Check nonce against stored per-payer nonce
        let current = storage::get_payer_nonce(&env, &payer);
        if nonce != current {
            return Err(PaymentError::InvalidNonce);
        }

        if storage::get_payment(&env, &order_id).is_some() {
            return Err(PaymentError::PaymentAlreadyExists);
        }

        let merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        if !merchant.active {
            return Err(PaymentError::MerchantInactive);
        }

        // Transfer tokens from payer to merchant
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&payer, &merchant_address, &amount);

        let now = env.ledger().timestamp();
        let payment = PaymentOrder {
            order_id: order_id.clone(),
            merchant_address: merchant_address.clone(),
            payer: payer.clone(),
            token: token_address,
            amount,
            status: PaymentStatus::Completed,
            paid_at: now,
            refunded_amount: 0,
            memo,
            tags,
        };

        storage::set_payment(&env, &payment);
        storage::add_merchant_payment_id(&env, &merchant_address, &order_id);
        storage::add_payer_payment_id(&env, &payer, &order_id);

        // Update merchant total
        let mut m = merchant;
        m.total_received += amount;
        storage::set_merchant(&env, &m);

        // Update global stats
        let mut stats = storage::get_global_stats(&env);
        stats.total_payments += 1;
        stats.total_volume += amount;
        storage::set_global_stats(&env, &stats);

        // Increment payer nonce on success
        storage::increment_payer_nonce(&env, &payer);

        env.events().publish(
            ("lumenflow", "payment_processed"),
            (order_id, payer, merchant_address, amount),
        );
        Ok(())
    }

    /// Pay multiple merchants in one transaction. Maximum 10 items. Atomic.
    ///
    /// All items are validated and transferred atomically — if any item fails the
    /// entire batch is rolled back.
    ///
    /// # Arguments
    /// * `payer` - Address funding all payments. Must sign the call.
    /// * `payments` - List of up to 10 [`BatchPaymentItem`] entries, each containing
    ///   `order_id`, `merchant_address`, `token_address`, `amount`, `memo`,
    ///   `signature`, and `merchant_public_key`.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::BatchSizeExceeded`] — more than 10 items provided.
    /// * [`PaymentError::InvalidAmount`] — any item has a non-positive amount.
    /// * [`PaymentError::InvalidInput`] — any item has an empty `order_id`.
    /// * [`PaymentError::TokenNotAllowed`] — any item's token is not on the allow-list.
    /// * [`PaymentError::PaymentAlreadyExists`] — any item's `order_id` already exists.
    /// * [`PaymentError::MerchantNotFound`] — any item's merchant is not registered.
    /// * [`PaymentError::MerchantInactive`] — any item's merchant is deactivated.
    /// * [`PaymentError::InvalidSignature`] — any item's signature verification fails.
    pub fn batch_payment(
        env: Env,
        payer: Address,
        payments: Vec<BatchPaymentItem>,
    ) -> Result<(), PaymentError> {
        payer.require_auth();
        if payments.len() > 10 {
            return Err(PaymentError::BatchSizeExceeded);
        }

        for item in payments.iter() {
            require_positive(item.amount)?;
            require_non_empty_string(&item.order_id)?;

            if !storage::is_token_allowed(&env, &item.token_address) {
                return Err(PaymentError::TokenNotAllowed);
            }

            if storage::get_payment(&env, &item.order_id).is_some() {
                return Err(PaymentError::PaymentAlreadyExists);
            }

            let merchant = storage::get_merchant(&env, &item.merchant_address)
                .ok_or(PaymentError::MerchantNotFound)?;
            if !merchant.active {
                return Err(PaymentError::MerchantInactive);
            }

            // Build payload: XDR-encoded order_id + big-endian amount (same format as process_payment_with_signature)
            let mut payload = Bytes::new(&env);
            payload.append(&item.order_id.clone().to_xdr(&env));
            payload.append(&Bytes::from_slice(&env, &item.amount.to_be_bytes()));
            verify_signature(&env, &item.merchant_public_key, &payload, &item.signature)?;

            // Transfer tokens from payer to merchant
            let token_client = token::Client::new(&env, &item.token_address);
            token_client.transfer(&payer, &item.merchant_address, &item.amount);

            let now = env.ledger().timestamp();
            let payment = PaymentOrder {
                order_id: item.order_id.clone(),
                merchant_address: item.merchant_address.clone(),
                payer: payer.clone(),
                token: item.token_address.clone(),
                amount: item.amount,
                status: PaymentStatus::Completed,
                paid_at: now,
                refunded_amount: 0,
                memo: item.memo.clone(),
                tags: None,
                note: None,
            };

            storage::set_payment(&env, &payment);
            storage::add_merchant_payment_id(&env, &item.merchant_address, &item.order_id);
            storage::add_payer_payment_id(&env, &payer, &item.order_id);

            // Update merchant total
            let mut m = merchant;
            m.total_received += item.amount;
            storage::set_merchant(&env, &m);

            // Update global stats
            let mut stats = storage::get_global_stats(&env);
            stats.total_payments += 1;
            stats.total_volume = stats.total_volume.saturating_add(item.amount);
            storage::set_global_stats(&env, &stats);

            env.events().publish(
                ("lumenflow", "payment_processed"),
                (item.order_id, payer.clone(), item.merchant_address, item.amount),
            );
        }
        Ok(())
    }

    /// Get a single payment by order ID. Caller must be payer, merchant, or admin.
    ///
    /// # Arguments
    /// * `caller` - Address requesting the payment. Must sign the call.
    /// * `order_id` - The unique order identifier to look up.
    ///
    /// # Returns
    /// The [`PaymentOrder`] on success.
    ///
    /// # Errors
    /// * [`PaymentError::PaymentNotFound`] — no payment exists with `order_id`.
    /// * [`PaymentError::Unauthorized`] — `caller` is not the payer, merchant, or admin.
    pub fn get_payment_by_id(
        env: Env,
        caller: Address,
        order_id: String,
    ) -> Result<PaymentOrder, PaymentError> {
        caller.require_auth();
        let payment = storage::get_payment(&env, &order_id)
            .ok_or(PaymentError::PaymentNotFound)?;

        let is_admin = storage::get_admin(&env).map_or(false, |a| a == caller);
        if !is_admin && caller != payment.payer && caller != payment.merchant_address {
            return Err(PaymentError::Unauthorized);
        }
        Ok(payment)
    }

    /// Attach or update a merchant note on a completed payment (max 512 chars).
    ///
    /// # Arguments
    /// * `merchant` - Must be the merchant on the payment. Must sign the call.
    /// * `order_id` - The order to annotate.
    /// * `note` - Note text; maximum 512 characters.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidInput`] — `note` exceeds 512 characters.
    /// * [`PaymentError::PaymentNotFound`] — no payment exists with `order_id`.
    /// * [`PaymentError::Unauthorized`] — `merchant` is not the payment's merchant.
    pub fn add_payment_note(
        env: Env,
        merchant: Address,
        order_id: String,
        note: String,
    ) -> Result<(), PaymentError> {
        merchant.require_auth();
        if note.len() > 512 {
            return Err(PaymentError::InvalidInput);
        }
        let mut payment = storage::get_payment(&env, &order_id)
            .ok_or(PaymentError::PaymentNotFound)?;
        if payment.merchant_address != merchant {
            return Err(PaymentError::Unauthorized);
        }
        payment.note = Some(note);
        storage::set_payment(&env, &payment);
        env.events()
            .publish(("lumenflow", "payment_note_added"), order_id);
        Ok(())
    }

    /// Get a public summary of a payment by order ID. No auth required.
    ///
    /// Returns a reduced view of the payment that omits payer identity and private fields.
    ///
    /// # Arguments
    /// * `order_id` - The unique order identifier to look up.
    ///
    /// # Returns
    /// A [`PaymentSummary`] containing `order_id`, `merchant_address`, `amount`, `token`,
    /// `status`, and `paid_at`.
    ///
    /// # Errors
    /// * [`PaymentError::PaymentNotFound`] — no payment exists with `order_id`.
    pub fn get_payment_summary(
        env: Env,
        order_id: String,
    ) -> Result<PaymentSummary, PaymentError> {
        let payment = storage::get_payment(&env, &order_id)
            .ok_or(PaymentError::PaymentNotFound)?;

        Ok(PaymentSummary {
            order_id: payment.order_id,
            merchant_address: payment.merchant_address,
            amount: payment.amount,
            token: payment.token,
            status: payment.status,
            paid_at: payment.paid_at,
        })
    }

    /// Update payment status after a partial refund.
    ///
    /// Sets `refunded_amount` and transitions the payment status to
    /// [`PaymentStatus::PartiallyRefunded`] or [`PaymentStatus::FullyRefunded`].
    ///
    /// # Arguments
    /// * `caller` - Must be the admin or the payment's merchant. Must sign the call.
    /// * `order_id` - The order to update.
    /// * `refunded_amount` - Cumulative refunded amount so far.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::PaymentNotFound`] — no payment exists with `order_id`.
    /// * [`PaymentError::Unauthorized`] — `caller` is not the admin or the payment's merchant.
    pub fn update_payment_status(
        env: Env,
        caller: Address,
        order_id: String,
        refunded_amount: i128,
    ) -> Result<(), PaymentError> {
        let mut payment = storage::get_payment(&env, &order_id)
            .ok_or(PaymentError::PaymentNotFound)?;

        require_admin_or(&env, &caller, &payment.merchant_address.clone())?;

        payment.refunded_amount = refunded_amount;
        payment.status = if refunded_amount >= payment.amount {
            PaymentStatus::FullyRefunded
        } else {
            PaymentStatus::PartiallyRefunded
        };
        storage::set_payment(&env, &payment);
        Ok(())
    }

    /// Archive (remove) a payment record. Admin only.
    ///
    /// Removes the payment from storage and from the merchant and payer index lists,
    /// then emits a `lumenflow/payment_archived` event.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `order_id` - The order to archive.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    /// * [`PaymentError::PaymentNotFound`] — no payment exists with `order_id`.
    pub fn archive_payment_record(
        env: Env,
        admin: Address,
        order_id: String,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        let payment = storage::get_payment(&env, &order_id)
            .ok_or(PaymentError::PaymentNotFound)?;
        storage::remove_merchant_payment_id(&env, &payment.merchant_address, &order_id);
        storage::remove_payer_payment_id(&env, &payment.payer, &order_id);
        storage::remove_payment(&env, &order_id);
        env.events()
            .publish(("lumenflow", "payment_archived"), order_id);
        Ok(())
    }

    /// Remove payments older than the cleanup period. Admin only.
    ///
    /// Iterates all merchant payment indexes and deletes any payment whose `paid_at`
    /// timestamp is older than `now - cleanup_period`. Also removes the payment from
    /// the corresponding payer index.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    ///
    /// # Returns
    /// The number of payment records removed.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    pub fn cleanup_expired_payments(env: Env, admin: Address) -> Result<u32, PaymentError> {
        require_admin(&env, &admin)?;
        let cutoff = env
            .ledger()
            .timestamp()
            .saturating_sub(storage::get_cleanup_period(&env));

        let merchant_list = storage::get_merchant_list(&env);
        let mut removed: u32 = 0;

        for merchant_addr in merchant_list.iter() {
            let ids = storage::get_merchant_payment_ids(&env, &merchant_addr);
            for id in ids.iter() {
                if let Some(p) = storage::get_payment(&env, &id) {
                    if p.paid_at < cutoff {
                        storage::remove_payment(&env, &id);
                        storage::remove_merchant_payment_id(&env, &merchant_addr, &id);
                        storage::remove_payer_payment_id(&env, &p.payer, &id);
                        removed += 1;
                    }
                }
            }
        }
        Ok(removed)
    }

    // ── Payment history queries ───────────────────────────────────────────────

    /// Paginated payment history for a merchant.
    ///
    /// Returns a page of payments received by `merchant`, optionally filtered and sorted.
    /// Pagination is cursor-based: pass the `next_cursor` from the previous page to
    /// retrieve the next one.
    ///
    /// # Arguments
    /// * `merchant` - Merchant address. Must sign the call.
    /// * `cursor` - Optional `order_id` to start after (exclusive). `None` starts from
    ///   the beginning.
    /// * `limit` - Number of results per page; must be between 1 and 100 inclusive.
    /// * `filter` - Optional [`PaymentFilter`] to restrict results by date, amount,
    ///   token, status, or tag.
    /// * `sort_field` - [`SortField::Date`] or [`SortField::Amount`].
    /// * `sort_order` - [`SortOrder::Ascending`] or [`SortOrder::Descending`].
    ///
    /// # Returns
    /// A [`PaymentPage`] containing the matching payments, a `next_cursor` if more
    /// results exist, and the total count of matching payments.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidInput`] — `limit` is 0 or exceeds 100.
    pub fn get_merchant_payment_history(
        env: Env,
        merchant: Address,
        cursor: Option<String>,
        limit: u32,
        filter: Option<PaymentFilter>,
        sort_field: SortField,
        sort_order: SortOrder,
    ) -> Result<PaymentPage, PaymentError> {
        merchant.require_auth();
        require_valid_limit(limit)?;

        let ids = storage::get_merchant_payment_ids(&env, &merchant);
        Self::build_page(&env, ids, cursor, limit, filter, sort_field, sort_order)
    }

    /// Paginated payment history for a payer.
    ///
    /// Returns a page of payments made by `payer`, optionally filtered and sorted.
    /// Pagination is cursor-based: pass the `next_cursor` from the previous page to
    /// retrieve the next one.
    ///
    /// # Arguments
    /// * `payer` - Payer address. Must sign the call.
    /// * `cursor` - Optional `order_id` to start after (exclusive). `None` starts from
    ///   the beginning.
    /// * `limit` - Number of results per page; must be between 1 and 100 inclusive.
    /// * `filter` - Optional [`PaymentFilter`] to restrict results by date, amount,
    ///   token, status, or tag.
    /// * `sort_field` - [`SortField::Date`] or [`SortField::Amount`].
    /// * `sort_order` - [`SortOrder::Ascending`] or [`SortOrder::Descending`].
    ///
    /// # Returns
    /// A [`PaymentPage`] containing the matching payments, a `next_cursor` if more
    /// results exist, and the total count of matching payments.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidInput`] — `limit` is 0 or exceeds 100.
    pub fn get_payer_payment_history(
        env: Env,
        payer: Address,
        cursor: Option<String>,
        limit: u32,
        filter: Option<PaymentFilter>,
        sort_field: SortField,
        sort_order: SortOrder,
    ) -> Result<PaymentPage, PaymentError> {
        payer.require_auth();
        require_valid_limit(limit)?;

        let ids = storage::get_payer_payment_ids(&env, &payer);
        Self::build_page(&env, ids, cursor, limit, filter, sort_field, sort_order)
    }

    /// Global payment statistics. Admin only.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `_date_start` - Reserved for future date-range filtering (currently unused).
    /// * `_date_end` - Reserved for future date-range filtering (currently unused).
    ///
    /// # Returns
    /// A [`GlobalStats`] snapshot with `total_payments`, `total_volume`,
    /// `total_refunds`, `total_refund_volume`, and `active_merchants`.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    pub fn get_global_payment_stats(
        env: Env,
        admin: Address,
        _date_start: Option<u64>,
        _date_end: Option<u64>,
    ) -> Result<GlobalStats, PaymentError> {
        require_admin(&env, &admin)?;
        Ok(storage::get_global_stats(&env))
    }

    // ── Refunds ───────────────────────────────────────────────────────────────

    /// Initiate a refund request.
    ///
    /// Creates a [`RefundRecord`] in `Pending` state. The refund must subsequently be
    /// approved by the merchant or admin before it can be executed.
    ///
    /// # Arguments
    /// * `caller` - Must be the payer or merchant of the original payment. Must sign.
    /// * `refund_id` - Unique, non-empty identifier for this refund request.
    /// * `order_id` - The order being refunded.
    /// * `amount` - Positive amount to refund; cumulative refunded amount must not
    ///   exceed the original payment amount.
    /// * `reason` - Human-readable reason; maximum 256 characters.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidAmount`] — `amount` is not positive.
    /// * [`PaymentError::InvalidInput`] — `refund_id` is empty or `reason` exceeds 256 chars.
    /// * [`PaymentError::RefundAlreadyExists`] — a refund with `refund_id` already exists.
    /// * [`PaymentError::PaymentNotFound`] — no payment exists with `order_id`.
    /// * [`PaymentError::Unauthorized`] — `caller` is not the payer or merchant.
    /// * [`PaymentError::RefundWindowExpired`] — more than 30 days have passed since payment.
    /// * [`PaymentError::RefundExceedsOriginal`] — cumulative refund would exceed the
    ///   original payment amount.
    /// * [`PaymentError::TooManyRefunds`] — the per-order refund limit has been reached.
    pub fn initiate_refund(
        env: Env,
        caller: Address,
        refund_id: String,
        order_id: String,
        amount: i128,
        reason: String,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        require_positive(amount)?;
        require_non_empty_string(&refund_id)?;
        validate_memo_length(&reason)?;

        if storage::get_refund(&env, &refund_id).is_some() {
            return Err(PaymentError::RefundAlreadyExists);
        }

        let payment = storage::get_payment(&env, &order_id)
            .ok_or(PaymentError::PaymentNotFound)?;

        // Only payer or merchant may initiate
        if caller != payment.payer && caller != payment.merchant_address {
            return Err(PaymentError::Unauthorized);
        }

        // Refund window check
        let now = env.ledger().timestamp();
        if now > payment.paid_at + REFUND_WINDOW_SECS {
            return Err(PaymentError::RefundWindowExpired);
        }

        // Amount check
        if payment.refunded_amount + amount > payment.amount {
            return Err(PaymentError::RefundExceedsOriginal);
        }

        // Rate limit: cap pending refunds per order
        let max = storage::get_max_refunds_per_order(&env);
        if storage::get_order_refund_count(&env, &order_id) >= max {
            return Err(PaymentError::TooManyRefunds);
        }

        let refund = RefundRecord {
            refund_id: refund_id.clone(),
            order_id,
            initiator: caller,
            amount,
            reason,
            status: RefundStatus::Pending,
            created_at: now,
        };
        storage::set_refund(&env, &refund);
        storage::increment_order_refund_count(&env, &order_id);

        env.events()
            .publish(("lumenflow", "refund_initiated"), refund_id);
        Ok(())
    }

    /// Approve a refund. Merchant or admin only.
    ///
    /// Transitions the refund from `Pending` to `Approved`. The refund can then be
    /// executed by the merchant via [`execute_refund`].
    ///
    /// # Arguments
    /// * `caller` - Must be the payment's merchant or the admin. Must sign the call.
    /// * `refund_id` - The refund to approve.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::RefundNotFound`] — no refund exists with `refund_id`.
    /// * [`PaymentError::PaymentNotFound`] — the associated payment no longer exists.
    /// * [`PaymentError::Unauthorized`] — `caller` is not the merchant or admin.
    /// * [`PaymentError::RefundAlreadyCompleted`] — the refund is not in `Pending` state.
    pub fn approve_refund(
        env: Env,
        caller: Address,
        refund_id: String,
    ) -> Result<(), PaymentError> {
        let refund = storage::get_refund(&env, &refund_id)
            .ok_or(PaymentError::RefundNotFound)?;
        let payment = storage::get_payment(&env, &refund.order_id)
            .ok_or(PaymentError::PaymentNotFound)?;

        require_admin_or(&env, &caller, &payment.merchant_address)?;

        if !matches!(refund.status, RefundStatus::Pending) {
            return Err(PaymentError::RefundAlreadyCompleted);
        }

        let mut r = refund;
        r.status = RefundStatus::Approved;
        storage::set_refund(&env, &r);

        env.events()
            .publish(("lumenflow", "refund_approved"), refund_id);
        Ok(())
    }

    /// Reject a refund. Merchant or admin only.
    ///
    /// Transitions the refund from `Pending` to `Rejected`. The payer may subsequently
    /// open a dispute via [`dispute_refund`].
    ///
    /// # Arguments
    /// * `caller` - Must be the payment's merchant or the admin. Must sign the call.
    /// * `refund_id` - The refund to reject.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::RefundNotFound`] — no refund exists with `refund_id`.
    /// * [`PaymentError::PaymentNotFound`] — the associated payment no longer exists.
    /// * [`PaymentError::Unauthorized`] — `caller` is not the merchant or admin.
    /// * [`PaymentError::RefundAlreadyCompleted`] — the refund is not in `Pending` state.
    pub fn reject_refund(
        env: Env,
        caller: Address,
        refund_id: String,
    ) -> Result<(), PaymentError> {
        let refund = storage::get_refund(&env, &refund_id)
            .ok_or(PaymentError::RefundNotFound)?;
        let payment = storage::get_payment(&env, &refund.order_id)
            .ok_or(PaymentError::PaymentNotFound)?;

        require_admin_or(&env, &caller, &payment.merchant_address)?;

        if !matches!(refund.status, RefundStatus::Pending) {
            return Err(PaymentError::RefundAlreadyCompleted);
        }

        let mut r = refund;
        r.status = RefundStatus::Rejected;
        storage::set_refund(&env, &r);

        env.events()
            .publish(("lumenflow", "refund_rejected"), refund_id);
        Ok(())
    }

    /// Execute an approved refund — transfers tokens from merchant to payer.
    ///
    /// The merchant must authorise the token transfer. On success the refund status
    /// transitions to `Completed`, the payment's `refunded_amount` is updated, and
    /// global refund statistics are incremented.
    ///
    /// # Arguments
    /// * `refund_id` - The refund to execute. Must be in `Approved` state.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::RefundNotFound`] — no refund exists with `refund_id`.
    /// * [`PaymentError::RefundNotApproved`] — the refund is not in `Approved` state.
    /// * [`PaymentError::PaymentNotFound`] — the associated payment no longer exists.
    pub fn execute_refund(env: Env, refund_id: String) -> Result<(), PaymentError> {
        let refund = storage::get_refund(&env, &refund_id)
            .ok_or(PaymentError::RefundNotFound)?;

        if !matches!(refund.status, RefundStatus::Approved) {
            return Err(PaymentError::RefundNotApproved);
        }

        let mut payment = storage::get_payment(&env, &refund.order_id)
            .ok_or(PaymentError::PaymentNotFound)?;

        // Merchant must authorise the transfer
        payment.merchant_address.require_auth();

        let token_client = token::Client::new(&env, &payment.token);
        token_client.transfer(&payment.merchant_address, &payment.payer, &refund.amount);

        payment.refunded_amount += refund.amount;
        payment.status = if payment.refunded_amount >= payment.amount {
            PaymentStatus::FullyRefunded
        } else {
            PaymentStatus::PartiallyRefunded
        };
        storage::set_payment(&env, &payment);

        let mut r = refund;
        r.status = RefundStatus::Completed;
        storage::set_refund(&env, &r);

        let mut stats = storage::get_global_stats(&env);
        stats.total_refunds += 1;
        stats.total_refund_volume = stats.total_refund_volume.saturating_add(r.amount);
        storage::set_global_stats(&env, &stats);

        env.events()
            .publish(("lumenflow", "refund_executed"), refund_id);
        Ok(())
    }

    /// Get refund status.
    ///
    /// # Arguments
    /// * `refund_id` - The refund identifier to look up.
    ///
    /// # Returns
    /// The [`RefundRecord`] on success.
    ///
    /// # Errors
    /// * [`PaymentError::RefundNotFound`] — no refund exists with `refund_id`.
    pub fn get_refund(env: Env, refund_id: String) -> Result<RefundRecord, PaymentError> {
        storage::get_refund(&env, &refund_id).ok_or(PaymentError::RefundNotFound)
    }

    /// Payer disputes a rejected refund, providing evidence.
    ///
    /// Transitions the refund to `Disputed` and creates a [`DisputeRecord`]. The admin
    /// can then resolve the dispute via [`resolve_dispute`].
    ///
    /// # Arguments
    /// * `payer` - Must be the original initiator of the refund. Must sign the call.
    /// * `refund_id` - The refund to dispute.
    /// * `evidence` - Free-text evidence supporting the dispute.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::RefundNotFound`] — no refund exists with `refund_id`.
    /// * [`PaymentError::Unauthorized`] — `payer` is not the refund initiator.
    /// * [`PaymentError::RefundNotRejected`] — the refund is not in `Rejected` state.
    /// * [`PaymentError::DisputeAlreadyExists`] — a dispute for this refund already exists.
    pub fn dispute_refund(
        env: Env,
        payer: Address,
        refund_id: String,
        evidence: String,
    ) -> Result<(), PaymentError> {
        payer.require_auth();

        let mut refund = storage::get_refund(&env, &refund_id)
            .ok_or(PaymentError::RefundNotFound)?;

        if refund.initiator != payer {
            return Err(PaymentError::Unauthorized);
        }
        if !matches!(refund.status, RefundStatus::Rejected) {
            return Err(PaymentError::RefundNotRejected);
        }
        if storage::get_dispute(&env, &refund_id).is_some() {
            return Err(PaymentError::DisputeAlreadyExists);
        }

        refund.status = RefundStatus::Disputed;
        storage::set_refund(&env, &refund);

        let dispute = DisputeRecord {
            refund_id: refund_id.clone(),
            payer: payer.clone(),
            evidence,
            outcome: None,
            created_at: env.ledger().timestamp(),
        };
        storage::set_dispute(&env, &dispute);

        env.events()
            .publish(("lumenflow", "refund_disputed"), (refund_id, payer));
        Ok(())
    }

    /// Admin resolves a dispute, either favouring the payer (executes refund) or the merchant.
    ///
    /// If `outcome` is [`DisputeOutcome::FavorPayer`], the refund amount is transferred
    /// from the merchant to the payer and the refund is marked `Completed`. If
    /// [`DisputeOutcome::FavorMerchant`], the refund is marked `Rejected`.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `refund_id` - The disputed refund to resolve.
    /// * `outcome` - [`DisputeOutcome::FavorPayer`] or [`DisputeOutcome::FavorMerchant`].
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    /// * [`PaymentError::DisputeNotFound`] — no dispute exists for `refund_id`.
    /// * [`PaymentError::RefundAlreadyCompleted`] — the dispute has already been resolved.
    /// * [`PaymentError::RefundNotFound`] — the associated refund no longer exists.
    /// * [`PaymentError::PaymentNotFound`] — the associated payment no longer exists
    ///   (only relevant when favouring the payer).
    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        refund_id: String,
        outcome: DisputeOutcome,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;

        let mut dispute = storage::get_dispute(&env, &refund_id)
            .ok_or(PaymentError::DisputeNotFound)?;

        if dispute.outcome.is_some() {
            return Err(PaymentError::RefundAlreadyCompleted);
        }

        let mut refund = storage::get_refund(&env, &refund_id)
            .ok_or(PaymentError::RefundNotFound)?;

        match outcome {
            DisputeOutcome::FavorPayer => {
                // Approve and execute the refund
                let mut payment = storage::get_payment(&env, &refund.order_id)
                    .ok_or(PaymentError::PaymentNotFound)?;

                let token_client = token::Client::new(&env, &payment.token);
                token_client.transfer(&payment.merchant_address, &refund.initiator, &refund.amount);

                payment.refunded_amount += refund.amount;
                payment.status = if payment.refunded_amount >= payment.amount {
                    PaymentStatus::FullyRefunded
                } else {
                    PaymentStatus::PartiallyRefunded
                };
                storage::set_payment(&env, &payment);

                refund.status = RefundStatus::Completed;

                let mut stats = storage::get_global_stats(&env);
                stats.total_refunds += 1;
                stats.total_refund_volume += refund.amount;
                storage::set_global_stats(&env, &stats);
            }
            DisputeOutcome::FavorMerchant => {
                refund.status = RefundStatus::Rejected;
            }
        }

        storage::set_refund(&env, &refund);
        dispute.outcome = Some(outcome);
        storage::set_dispute(&env, &dispute);

        env.events()
            .publish(("lumenflow", "dispute_resolved"), refund_id);
        Ok(())
    }

    // ── Multi-signature payments ──────────────────────────────────────────────

    /// Initiate a multisig payment requiring `required_signatures` approvals.
    ///
    /// Creates a [`MultisigPayment`] record. Signers must call [`sign_multisig_payment`]
    /// until the threshold is met, then anyone can call [`execute_multisig_payment`].
    ///
    /// # Arguments
    /// * `initiator` - Address creating the multisig payment. Must sign the call.
    /// * `payment_id` - Unique, non-empty identifier for this multisig payment.
    /// * `merchant_address` - Registered, active merchant to receive the funds.
    /// * `token_address` - Allowed token contract address.
    /// * `amount` - Positive token amount.
    /// * `signers` - List of addresses authorised to sign; must contain no duplicates.
    /// * `required_signatures` - Minimum number of signatures needed to execute.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidAmount`] — `amount` is not positive.
    /// * [`PaymentError::InvalidInput`] — `payment_id` is empty or `signers` contains
    ///   duplicates.
    /// * [`PaymentError::TokenNotAllowed`] — `token_address` is not on the allow-list.
    /// * [`PaymentError::PaymentAlreadyExists`] — a multisig payment with `payment_id`
    ///   already exists.
    /// * [`PaymentError::MerchantNotFound`] — no merchant registered at `merchant_address`.
    /// * [`PaymentError::MerchantInactive`] — the merchant has been deactivated.
    pub fn initiate_multisig_payment(
        env: Env,
        initiator: Address,
        payment_id: String,
        merchant_address: Address,
        token_address: Address,
        amount: i128,
        signers: Vec<Address>,
        required_signatures: u32,
    ) -> Result<(), PaymentError> {
        initiator.require_auth();
        require_positive(amount)?;
        require_non_empty_string(&payment_id)?;

        if !storage::is_token_allowed(&env, &token_address) {
            return Err(PaymentError::TokenNotAllowed);
        }

        if storage::get_multisig(&env, &payment_id).is_some() {
            return Err(PaymentError::PaymentAlreadyExists);
        }

        let merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        if !merchant.active {
            return Err(PaymentError::MerchantInactive);
        }

        // Check for duplicate signers (#85)
        for i in 0..signers.len() {
            for j in (i + 1)..signers.len() {
                if signers.get(i).unwrap() == signers.get(j).unwrap() {
                    return Err(PaymentError::InvalidInput);
                }
            }
        }

        let ms = MultisigPayment {
            payment_id: payment_id.clone(),
            merchant_address,
            token: token_address,
            amount,
            required_signatures,
            signers,
            signatures: Vec::new(&env),
            signed_by: Vec::new(&env),
            executed: false,
            created_at: env.ledger().timestamp(),
        };
        storage::set_multisig(&env, &ms);

        env.events()
            .publish(("lumenflow", "multisig_initiated"), payment_id);
        Ok(())
    }

    /// Add a signature to a multisig payment.
    ///
    /// Each listed signer may call this once. Once `required_signatures` signatures
    /// are collected, the payment can be executed.
    ///
    /// # Arguments
    /// * `signer` - Must be in the payment's `signers` list. Must sign the call.
    /// * `payment_id` - The multisig payment to sign.
    /// * `signature` - The signer's signature bytes.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::MultisigNotFound`] — no multisig payment exists with `payment_id`.
    /// * [`PaymentError::MultisigAlreadyExecuted`] — the payment has already been executed.
    /// * [`PaymentError::Unauthorized`] — `signer` is not in the allowed signers list.
    /// * [`PaymentError::MultisigAlreadySigned`] — `signer` has already signed this payment.
    pub fn sign_multisig_payment(
        env: Env,
        signer: Address,
        payment_id: String,
        signature: Bytes,
    ) -> Result<(), PaymentError> {
        signer.require_auth();
        let mut ms = storage::get_multisig(&env, &payment_id)
            .ok_or(PaymentError::MultisigNotFound)?;

        if ms.executed {
            return Err(PaymentError::MultisigAlreadyExecuted);
        }

        // Verify signer is in the allowed list
        if !ms.signers.contains(&signer) {
            return Err(PaymentError::Unauthorized);
        }

        // Prevent double-signing: check if this signer has already signed
        if ms.signed_by.contains(&signer) {
            return Err(PaymentError::MultisigAlreadySigned);
        }

        ms.signatures.push_back(signature);
        ms.signed_by.push_back(signer);
        storage::set_multisig(&env, &ms);
        Ok(())
    }

    /// Execute a multisig payment once enough signatures are collected.
    ///
    /// Transfers `amount` tokens from `payer` to the merchant, records the payment in
    /// history indexes, and emits a `lumenflow/multisig_executed` event.
    ///
    /// # Arguments
    /// * `payer` - Address funding the transfer. Must sign the call.
    /// * `payment_id` - The multisig payment to execute.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::MultisigNotFound`] — no multisig payment exists with `payment_id`.
    /// * [`PaymentError::MultisigAlreadyExecuted`] — the payment has already been executed.
    /// * [`PaymentError::InsufficientSignatures`] — fewer signatures than required.
    pub fn execute_multisig_payment(
        env: Env,
        payer: Address,
        payment_id: String,
    ) -> Result<(), PaymentError> {
        payer.require_auth();
        let mut ms = storage::get_multisig(&env, &payment_id)
            .ok_or(PaymentError::MultisigNotFound)?;

        if ms.executed {
            return Err(PaymentError::MultisigAlreadyExecuted);
        }

        if ms.signatures.len() < ms.required_signatures {
            return Err(PaymentError::InsufficientSignatures);
        }

        let token_client = token::Client::new(&env, &ms.token);
        token_client.transfer(&payer, &ms.merchant_address, &ms.amount);

        ms.executed = true;
        storage::set_multisig(&env, &ms);

        // Record payment in history so it appears in merchant/payer queries
        let payment = PaymentOrder {
            order_id: payment_id.clone(),
            merchant_address: ms.merchant_address.clone(),
            payer: payer.clone(),
            token: ms.token.clone(),
            amount: ms.amount,
            status: PaymentStatus::Completed,
            paid_at: env.ledger().timestamp(),
            refunded_amount: 0,
            memo: String::from_str(&env, ""),
            tags: None,
        };
        storage::set_payment(&env, &payment);
        storage::add_merchant_payment_id(&env, &ms.merchant_address, &payment_id);
        storage::add_payer_payment_id(&env, &payer, &payment_id);

        // Update merchant total
        if let Some(mut merchant) = storage::get_merchant(&env, &ms.merchant_address) {
            merchant.total_received += ms.amount;
            storage::set_merchant(&env, &merchant);
        }

        let mut stats = storage::get_global_stats(&env);
        stats.total_payments += 1;
        stats.total_volume = stats.total_volume.saturating_add(ms.amount);
        storage::set_global_stats(&env, &stats);

        env.events()
            .publish(("lumenflow", "multisig_executed"), payment_id);
        Ok(())
    }

    // ── Subscriptions ─────────────────────────────────────────────────────────

    /// Create a recurring payment plan. Merchant only.
    ///
    /// # Arguments
    /// * `merchant` - Registered, active merchant creating the plan. Must sign the call.
    /// * `plan_id` - Unique, non-empty identifier for this plan.
    /// * `token` - Token contract address used for charges.
    /// * `amount` - Positive amount charged per cycle.
    /// * `interval_secs` - Minimum seconds between consecutive charges.
    /// * `max_cycles` - Total number of billing cycles before the plan completes.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidAmount`] — `amount` is not positive.
    /// * [`PaymentError::InvalidInput`] — `plan_id` is empty.
    /// * [`PaymentError::SubscriptionPlanAlreadyExists`] — a plan with `plan_id` exists.
    /// * [`PaymentError::MerchantNotFound`] — `merchant` is not registered.
    /// * [`PaymentError::MerchantInactive`] — the merchant has been deactivated.
    pub fn create_subscription_plan(
        env: Env,
        merchant: Address,
        plan_id: String,
        token: Address,
        amount: i128,
        interval_secs: u64,
        max_cycles: u32,
    ) -> Result<(), PaymentError> {
        merchant.require_auth();
        require_positive(amount)?;
        require_non_empty_string(&plan_id)?;

        if storage::get_subscription_plan(&env, &plan_id).is_some() {
            return Err(PaymentError::SubscriptionPlanAlreadyExists);
        }

        let m = storage::get_merchant(&env, &merchant).ok_or(PaymentError::MerchantNotFound)?;
        if !m.active {
            return Err(PaymentError::MerchantInactive);
        }

        let plan = SubscriptionPlan { plan_id, merchant, token, amount, interval_secs, max_cycles };
        storage::set_subscription_plan(&env, &plan);
        Ok(())
    }

    /// Subscribe to a plan.
    ///
    /// Creates an `Active` [`Subscription`] linked to the given plan. The first charge
    /// can be triggered immediately via [`charge_subscription`].
    ///
    /// # Arguments
    /// * `subscriber` - Address subscribing to the plan. Must sign the call.
    /// * `subscription_id` - Unique, non-empty identifier for this subscription.
    /// * `plan_id` - The plan to subscribe to.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidInput`] — `subscription_id` is empty.
    /// * [`PaymentError::SubscriptionAlreadyExists`] — a subscription with `subscription_id`
    ///   already exists.
    /// * [`PaymentError::SubscriptionPlanNotFound`] — no plan exists with `plan_id`.
    pub fn subscribe(
        env: Env,
        subscriber: Address,
        subscription_id: String,
        plan_id: String,
    ) -> Result<(), PaymentError> {
        subscriber.require_auth();
        require_non_empty_string(&subscription_id)?;

        if storage::get_subscription(&env, &subscription_id).is_some() {
            return Err(PaymentError::SubscriptionAlreadyExists);
        }
        storage::get_subscription_plan(&env, &plan_id)
            .ok_or(PaymentError::SubscriptionPlanNotFound)?;

        let now = env.ledger().timestamp();
        let sub = Subscription {
            subscription_id,
            plan_id,
            subscriber,
            cycles_charged: 0,
            last_charged_at: 0,
            status: SubscriptionStatus::Active,
            created_at: now,
        };
        storage::set_subscription(&env, &sub);
        Ok(())
    }

    /// Charge the next cycle of a subscription. Anyone can trigger (merchant typically).
    ///
    /// Transfers the plan amount from the subscriber to the merchant, increments
    /// `cycles_charged`, and marks the subscription `Completed` when `max_cycles` is
    /// reached.
    ///
    /// # Arguments
    /// * `subscription_id` - The subscription to charge.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::SubscriptionNotFound`] — no subscription exists with `subscription_id`.
    /// * [`PaymentError::SubscriptionNotActive`] — the subscription is not in `Active` state.
    /// * [`PaymentError::SubscriptionPlanNotFound`] — the associated plan no longer exists.
    /// * [`PaymentError::SubscriptionMaxCyclesReached`] — all cycles have been charged.
    /// * [`PaymentError::SubscriptionIntervalNotElapsed`] — not enough time has passed since
    ///   the last charge.
    pub fn charge_subscription(
        env: Env,
        subscription_id: String,
    ) -> Result<(), PaymentError> {
        let mut sub = storage::get_subscription(&env, &subscription_id)
            .ok_or(PaymentError::SubscriptionNotFound)?;

        if !matches!(sub.status, SubscriptionStatus::Active) {
            return Err(PaymentError::SubscriptionNotActive);
        }

        let plan = storage::get_subscription_plan(&env, &sub.plan_id)
            .ok_or(PaymentError::SubscriptionPlanNotFound)?;

        if sub.cycles_charged >= plan.max_cycles {
            sub.status = SubscriptionStatus::Completed;
            storage::set_subscription(&env, &sub);
            return Err(PaymentError::SubscriptionMaxCyclesReached);
        }

        let now = env.ledger().timestamp();
        if sub.last_charged_at > 0 && now < sub.last_charged_at + plan.interval_secs {
            return Err(PaymentError::SubscriptionIntervalNotElapsed);
        }

        let token_client = token::Client::new(&env, &plan.token);
        token_client.transfer(&sub.subscriber, &plan.merchant, &plan.amount);

        sub.cycles_charged += 1;
        sub.last_charged_at = now;
        if sub.cycles_charged >= plan.max_cycles {
            sub.status = SubscriptionStatus::Completed;
        }
        storage::set_subscription(&env, &sub);

        let mut stats = storage::get_global_stats(&env);
        stats.total_payments += 1;
        stats.total_volume += plan.amount;
        storage::set_global_stats(&env, &stats);

        env.events().publish(
            ("lumenflow", "subscription_charged"),
            (subscription_id, sub.cycles_charged),
        );
        Ok(())
    }

    /// Cancel an active subscription. Subscriber only.
    ///
    /// Transitions the subscription to `Cancelled` and emits a
    /// `lumenflow/subscription_cancelled` event. No further charges can be made.
    ///
    /// # Arguments
    /// * `subscriber` - Must be the subscription's owner. Must sign the call.
    /// * `subscription_id` - The subscription to cancel.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::SubscriptionNotFound`] — no subscription exists with `subscription_id`.
    /// * [`PaymentError::Unauthorized`] — `subscriber` is not the subscription owner.
    /// * [`PaymentError::SubscriptionNotActive`] — the subscription is not in `Active` state.
    pub fn cancel_subscription(
        env: Env,
        subscriber: Address,
        subscription_id: String,
    ) -> Result<(), PaymentError> {
        subscriber.require_auth();
        let mut sub = storage::get_subscription(&env, &subscription_id)
            .ok_or(PaymentError::SubscriptionNotFound)?;

        if sub.subscriber != subscriber {
            return Err(PaymentError::Unauthorized);
        }
        if !matches!(sub.status, SubscriptionStatus::Active) {
            return Err(PaymentError::SubscriptionNotActive);
        }

        sub.status = SubscriptionStatus::Cancelled;
        storage::set_subscription(&env, &sub);

        env.events()
            .publish(("lumenflow", "subscription_cancelled"), subscription_id);
        Ok(())
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    fn build_page(
        env: &Env,
        ids: Vec<String>,
        cursor: Option<String>,
        limit: u32,
        filter: Option<PaymentFilter>,
        sort_field: SortField,
        sort_order: SortOrder,
    ) -> Result<PaymentPage, PaymentError> {
        // Collect matching payments
        let mut payments: Vec<PaymentOrder> = Vec::new(env);
        let mut skip = cursor.is_some();

        for id in ids.iter() {
            // Cursor: skip until we pass the cursor id
            if skip {
                if Some(id.clone()) == cursor {
                    skip = false;
                }
                continue;
            }

            if let Some(p) = storage::get_payment(env, &id) {
                if Self::matches_filter(&p, &filter) {
                    payments.push_back(p);
                }
            }
        }

        // Sort
        let mut sorted: Vec<PaymentOrder> = Vec::new(env);
        // Simple insertion sort (WASM-friendly, no std)
        for p in payments.iter() {
            let mut inserted = false;
            let mut new_vec: Vec<PaymentOrder> = Vec::new(env);
            for s in sorted.iter() {
                if !inserted && Self::should_insert_before(&p, &s, &sort_field, &sort_order) {
                    new_vec.push_back(p.clone());
                    inserted = true;
                }
                new_vec.push_back(s);
            }
            if !inserted {
                new_vec.push_back(p);
            }
            sorted = new_vec;
        }

        let total = sorted.len();
        let mut result: Vec<PaymentOrder> = Vec::new(env);
        let mut next_cursor: Option<String> = None;

        for (i, p) in sorted.iter().enumerate() {
            if i as u32 >= limit {
                next_cursor = Some(p.order_id.clone());
                break;
            }
            result.push_back(p);
        }

        Ok(PaymentPage {
            payments: result,
            next_cursor,
            total,
        })
    }

    fn matches_filter(payment: &PaymentOrder, filter: &Option<PaymentFilter>) -> bool {
        let f = match filter {
            Some(f) => f,
            None => return true,
        };
        if let Some(start) = f.date_start {
            if payment.paid_at < start {
                return false;
            }
        }
        if let Some(end) = f.date_end {
            if payment.paid_at > end {
                return false;
            }
        }
        if let Some(min) = f.amount_min {
            if payment.amount < min {
                return false;
            }
        }
        if let Some(max) = f.amount_max {
            if payment.amount > max {
                return false;
            }
        }
        if let Some(ref tok) = f.token {
            if payment.token != *tok {
                return false;
            }
        }
        match f.status {
            StatusFilter::Any => {}
            StatusFilter::Completed => {
                if !matches!(payment.status, PaymentStatus::Completed) {
                    return false;
                }
            }
            StatusFilter::PartiallyRefunded => {
                if !matches!(payment.status, PaymentStatus::PartiallyRefunded) {
                    return false;
                }
            }
            StatusFilter::FullyRefunded => {
                if !matches!(payment.status, PaymentStatus::FullyRefunded) {
                    return false;
                }
            }
        }
        if let Some(ref tag) = f.tag {
            match payment.tags {
                Some(ref tags) => {
                    if !tags.contains(tag) {
                        return false;
                    }
                }
                None => return false,
            }
        }
        true
    }

    fn should_insert_before(
        a: &PaymentOrder,
        b: &PaymentOrder,
        field: &SortField,
        order: &SortOrder,
    ) -> bool {
        let cmp = match field {
            SortField::Date => a.paid_at.cmp(&b.paid_at),
            SortField::Amount => a.amount.cmp(&b.amount),
        };
        match order {
            SortOrder::Ascending => cmp == core::cmp::Ordering::Less,
            SortOrder::Descending => cmp == core::cmp::Ordering::Greater,
        }
    }

    // ── Payment Requests ──────────────────────────────────────────────────────

    /// Create a payment request that can be shared as a link.
    ///
    /// The request expires after `ttl` seconds. A payer can fulfil it via
    /// [`pay_payment_request`] before expiry.
    ///
    /// # Arguments
    /// * `merchant` - Merchant creating the request. Must sign the call.
    /// * `request_id` - Unique, non-empty identifier for this request.
    /// * `token` - Allowed token contract address.
    /// * `amount` - Positive amount the payer must send.
    /// * `memo` - Optional description attached to the resulting payment record.
    /// * `ttl` - Time-to-live in seconds from the current ledger timestamp.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidAmount`] — `amount` is not positive.
    /// * [`PaymentError::InvalidInput`] — `request_id` is empty.
    /// * [`PaymentError::TokenNotAllowed`] — `token` is not on the allow-list.
    /// * [`PaymentError::PaymentAlreadyExists`] — a request with `request_id` already exists.
    pub fn create_payment_request(
        env: Env,
        merchant: Address,
        request_id: String,
        token: Address,
        amount: i128,
        memo: String,
        ttl: u64,
    ) -> Result<(), PaymentError> {
        merchant.require_auth();
        require_positive(amount)?;
        require_non_empty_string(&request_id)?;

        if !storage::is_token_allowed(&env, &token) {
            return Err(PaymentError::TokenNotAllowed);
        }

        if storage::get_payment_request(&env, &request_id).is_some() {
            return Err(PaymentError::PaymentAlreadyExists);
        }

        let expires_at = env.ledger().timestamp().saturating_add(ttl);

        let pr = PaymentRequest {
            request_id,
            merchant,
            token,
            amount,
            memo,
            expires_at,
        };

        storage::set_payment_request(&env, &pr);
        Ok(())
    }

    /// Pay a previously created payment request.
    ///
    /// Transfers the requested amount from `payer` to the merchant, records the
    /// payment in history indexes, updates global stats, removes the request, and
    /// emits a `lumenflow/payment_request_paid` event.
    ///
    /// # Arguments
    /// * `payer` - Address funding the payment. Must sign the call.
    /// * `request_id` - The payment request to fulfil.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::PaymentNotFound`] — no request exists with `request_id`.
    /// * [`PaymentError::PaymentExpired`] — the request TTL has elapsed (request is removed).
    pub fn pay_payment_request(
        env: Env,
        payer: Address,
        request_id: String,
    ) -> Result<(), PaymentError> {
        payer.require_auth();

        let pr = storage::get_payment_request(&env, &request_id)
            .ok_or(PaymentError::PaymentNotFound)?;

        if env.ledger().timestamp() > pr.expires_at {
            storage::remove_payment_request(&env, &request_id);
            return Err(PaymentError::PaymentExpired);
        }

        // Transfer tokens from payer to merchant
        let token_client = token::Client::new(&env, &pr.token);
        token_client.transfer(&payer, &pr.merchant, &pr.amount);

        // Create a PaymentOrder for history
        let now = env.ledger().timestamp();
        let payment = PaymentOrder {
            order_id: pr.request_id.clone(),
            merchant_address: pr.merchant.clone(),
            payer: payer.clone(),
            token: pr.token,
            amount: pr.amount,
            status: PaymentStatus::Completed,
            paid_at: now,
            refunded_amount: 0,
            memo: pr.memo,
            tags: None,
            note: None,
        };

        storage::set_payment(&env, &payment);
        storage::add_merchant_payment_id(&env, &pr.merchant, &pr.request_id);
        storage::add_payer_payment_id(&env, &payer, &pr.request_id);

        // Update stats
        let mut stats = storage::get_global_stats(&env);
        stats.total_payments += 1;
        stats.total_volume = stats.total_volume.saturating_add(pr.amount);
        storage::set_global_stats(&env, &stats);

        // Remove the request as it's paid
        storage::remove_payment_request(&env, &request_id);

        env.events().publish(("lumenflow", "payment_request_paid"), request_id);
        Ok(())
    }
}
