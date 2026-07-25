#![no_std]

extern crate alloc;

pub mod error;
mod helper;
mod storage;
pub mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, xdr::ToXdr, Address, Bytes, Env, String, Vec};

use error::PaymentError;
use helper::{
    require_admin, require_admin_or, require_min_refund_amount, require_non_empty_string,
    require_not_paused, require_positive, require_valid_id, require_valid_limit,
    validate_merchant_category, validate_tags, verify_signature,
};
use types::{
    BatchPaymentItem, GlobalStats, Merchant, MerchantCategory, MerchantPage, MerchantStats,
    MultisigPayment, PaymentFilter, PaymentOrder, PaymentPage, PaymentRequest, PaymentStatus,
    PaymentSummary, RefundRecord, RefundStatus, SignatureEntry, SortField, SortOrder, StatusFilter,
    Subscription, SubscriptionPlan, SubscriptionStatus, SuspiciousActivityReason,
};

// ── Contract ──────────────────────────────────────────────────────────────────

#[contract]
pub struct PaymentProcessingContract;

#[contractimpl]
impl PaymentProcessingContract {
    // ── Versioning ────────────────────────────────────────────────────────────

    /// Returns the contract version.
    pub fn get_contract_version(_env: Env) -> String {
        String::from_str(&_env, env!("CARGO_PKG_VERSION"))
    }

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

        admin.require_auth();
        storage::set_admin(&env, &admin);
        env.events().publish(("lumenflow", "admin_set"), admin);
        Ok(())
    }

    /// Transfer admin rights to a new address.
    ///
    /// # Arguments
    /// * `current_admin` - Must be the currently configured administrator. Must sign the call.
    /// * `new_admin` - The address to receive admin rights. Must differ from `current_admin`
    ///   and must not be the zero/all-zeros address.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `current_admin` is not the configured administrator.
    /// * [`PaymentError::InvalidAdminAddress`] — `new_admin` is the zero address or is the
    ///   same address as `current_admin` (self-transfer).
    pub fn transfer_admin(
        env: Env,
        current_admin: Address,
        new_admin: Address,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &current_admin)?;

        if new_admin == current_admin {
            return Err(PaymentError::InvalidAdminAddress);
        }

        // Block zero address: an all-zeros XDR-encoded public key would permanently
        // lock the contract with no valid admin able to authenticate.
        {
            use soroban_sdk::xdr::ToXdr;
            let raw = new_admin.clone().to_xdr(&env);
            if raw.iter().all(|b| b == 0) {
                return Err(PaymentError::InvalidAdminAddress);
            }
        }

        storage::set_admin(&env, &new_admin);
        env.events()
            .publish(("lumenflow", "admin_transferred"), (current_admin, new_admin));
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
        Ok(())
    }

    /// Set the platform fee in basis points and the fee recipient address (admin only).
    /// Fee is deducted from each payment processed via `process_payment_with_signature`.
    pub fn set_platform_fee(
        env: Env,
        admin: Address,
        fee_bps: u32,
        fee_recipient: Address,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        if fee_bps > storage::MAX_PLATFORM_FEE_BPS {
            return Err(PaymentError::InvalidInput);
        }
        storage::set_platform_fee_bps(&env, fee_bps);
        storage::set_fee_recipient(&env, &fee_recipient);
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

    /// Add a token to the whitelist (admin only).
    pub fn add_allowed_token(env: Env, admin: Address, token: Address) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        storage::set_token_allowed(&env, &token, true);
        env.events().publish(("lumenflow", "token_allowed"), token);
        Ok(())
    }

    /// Remove a token from the whitelist (admin only).
    pub fn remove_allowed_token(
        env: Env,
        admin: Address,
        token: Address,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        storage::set_token_allowed(&env, &token, false);
        env.events().publish(("lumenflow", "token_removed"), token);
        Ok(())
    }

    /// Set the default expiry duration (seconds) for new multisig payments. Admin only.
    pub fn set_multisig_expiry_duration(
        env: Env,
        admin: Address,
        duration: u64,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        if duration == 0 {
            return Err(PaymentError::InvalidInput);
        }
        storage::set_multisig_expiry_duration(&env, duration);
        Ok(())
    }

    /// Set the refund window in seconds (default 30 days). Admin only.
    pub fn set_refund_window(
        env: Env,
        admin: Address,
        window_secs: u64,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        if window_secs < storage::MIN_REFUND_WINDOW_SECS {
            return Err(PaymentError::InvalidInput);
        }
        storage::set_refund_window(&env, window_secs);
        env.events().publish(("lumenflow", "refund_window_set"), window_secs);
        Ok(())
    }

    /// Pause the contract. All state-mutating functions will return ContractPaused. Admin only.
    pub fn pause_contract(env: Env, admin: Address) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        storage::set_paused(&env, true);
        env.events().publish(("lumenflow", "contract_paused"), ());
        Ok(())
    }

    /// Unpause the contract. Admin only.
    pub fn unpause_contract(env: Env, admin: Address) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        storage::set_paused(&env, false);
        env.events().publish(("lumenflow", "contract_unpaused"), ());
        Ok(())
    }

    /// Set the minimum refund amount (default 100 stroops). Admin only.
    pub fn set_min_refund_amount(
        env: Env,
        admin: Address,
        amount: i128,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        require_positive(amount)?;
        storage::set_min_refund_amount(&env, amount);
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
        require_not_paused(&env)?;
        merchant_address.require_auth();
        require_non_empty_string(&name)?;
        validate_merchant_category(&category)?;

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

    /// Update merchant profile (merchant only).
    pub fn update_merchant(
        env: Env,
        merchant_address: Address,
        name: String,
        description: String,
        contact_info: String,
        category: MerchantCategory,
    ) -> Result<(), PaymentError> {
        merchant_address.require_auth();
        require_non_empty_string(&name)?;

        let mut merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;

        if !merchant.active {
            return Err(PaymentError::MerchantInactive);
        }

        merchant.name = name;
        merchant.description = description;
        merchant.contact_info = contact_info;
        merchant.category = category;

        storage::set_merchant(&env, &merchant);

        env.events()
            .publish(("lumenflow", "merchant_updated"), merchant_address);
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
        require_not_paused(&env)?;
        require_admin(&env, &admin)?;
        let mut merchant =
            storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)?;
        merchant.active = false;
        storage::set_merchant(&env, &merchant);

        let mut stats = storage::get_global_stats(&env);
        if stats.active_merchants > 0 {
            stats.active_merchants -= 1;
        }
        storage::set_global_stats(&env, &stats);

        env.events()
            .publish(("lumenflow", "merchant_deactivated"), merchant_address);
        Ok(())
    }

    /// Reactivate a merchant (admin only).
    pub fn reactivate_merchant(
        env: Env,
        admin: Address,
        merchant_address: Address,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        require_admin(&env, &admin)?;
        let mut merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        if merchant.active {
            return Err(PaymentError::InvalidInput);
        }
        merchant.active = true;
        storage::set_merchant(&env, &merchant);

        let mut stats = storage::get_global_stats(&env);
        stats.active_merchants += 1;
        storage::set_global_stats(&env, &stats);

        env.events()
            .publish(("lumenflow", "merchant_reactivated"), merchant_address);
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
        let mut merchant =
            storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)?;
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
        require_not_paused(&env)?;
        require_admin(&env, &admin)?;
        let mut merchant =
            storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)?;
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
        require_not_paused(&env)?;
        payer.require_auth();
        require_positive(amount)?;
        require_valid_id(&order_id)?;
        validate_tags(&tags)?;

        if !storage::is_token_allowed(&env, &token_address) {
            return Err(PaymentError::TokenNotAllowed);
        }

        if storage::get_payment(&env, &order_id).is_some() {
            return Err(PaymentError::PaymentAlreadyExists);
        }

        let merchant =
            storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)?;
        if !merchant.active {
            return Err(PaymentError::MerchantInactive);
        }

        // Reject disallowed tokens
        if !storage::is_token_allowed(&env, &token_address) {
            return Err(PaymentError::TokenNotAllowed);
        }

        // Build payload: order_id bytes + amount bytes
        let mut payload = Bytes::new(&env);
        let network_id_bytes: Bytes = env.ledger().network_id().into();
        payload.append(&network_id_bytes);
        payload.append(&env.current_contract_address().to_xdr(&env));
        payload.append(&order_id.clone().to_xdr(&env));
        payload.append(&Bytes::from_slice(&env, &amount.to_be_bytes()));
        verify_signature(&env, &merchant_public_key, &payload, &signature)?;

        // Transfer tokens from payer to merchant (minus platform fee)
        let token_client = token::Client::new(&env, &token_address);
        let fee_bps = storage::get_platform_fee_bps(&env);
        let platform_fee: i128 = if fee_bps > 0 {
            amount * (fee_bps as i128) / 10_000
        } else {
            0
        };
        let merchant_amount = amount - platform_fee;
        token_client.transfer(&payer, &merchant_address, &merchant_amount);
        if platform_fee > 0 {
            if let Some(recipient) = storage::get_fee_recipient(&env) {
                token_client.transfer(&payer, &recipient, &platform_fee);
            }
        }

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
            platform_fee,
        };

        storage::set_payment(&env, &payment);
        storage::add_merchant_payment_id(&env, &merchant_address, &order_id)?;
        storage::add_payer_payment_id(&env, &payer, &order_id)?;

        // Update merchant total (net of fee)
        let mut m = merchant;
        m.total_received += merchant_amount;
        storage::set_merchant(&env, &m);

        // Update merchant stats
        let mut merchant_stats = storage::get_merchant_stats(&env, &merchant_address);
        merchant_stats.total_payments += 1;
        merchant_stats.total_volume = merchant_stats.total_volume.saturating_add(amount);
        storage::set_merchant_stats(&env, &merchant_address, &merchant_stats);

        // Update global stats
        let mut stats = storage::get_global_stats(&env);
        stats.total_payments += 1;
        stats.total_volume = stats.total_volume.saturating_add(amount);
        storage::set_global_stats(&env, &stats);

        // Check for suspicious activity (Issue #96)
        let threshold = storage::get_large_payment_threshold(&env);
        if amount >= threshold {
            env.events().publish(
                ("lumenflow", "suspicious_activity"),
                (
                    SuspiciousActivityReason::LargePayment,
                    payer.clone(),
                    amount,
                ),
            );
        }

        env.events().publish(
            ("lumenflow", "payment_processed"),
            (order_id, payer, merchant_address, amount),
        );
        Ok(())
    }

    /// Process a payment using a per-payer sequential nonce for replay protection.
    ///
    /// The contract stores the next expected nonce for each payer. A payment is
    /// accepted only when the supplied `nonce` equals the stored value, after which
    /// the stored nonce is incremented. Any other value (replayed or skipped) is
    /// rejected with [`PaymentError::InvalidNonce`].
    ///
    /// # Arguments
    /// * `payer` - Address funding the payment. Must sign the call.
    /// * `order_id` - Unique order identifier.
    /// * `merchant_address` - Registered, active merchant to receive funds.
    /// * `token_address` - Allowed token contract address.
    /// * `amount` - Positive token amount in stroops.
    /// * `memo` - Payment description (max 256 chars).
    /// * `tags` - Optional payment tags.
    /// * `nonce` - Must equal the payer's current stored nonce (starts at 0).
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidAmount`] — `amount` is not positive.
    /// * [`PaymentError::InvalidInput`] — `order_id` is empty or tags are invalid.
    /// * [`PaymentError::TokenNotAllowed`] — `token_address` is not on the allow-list.
    /// * [`PaymentError::PaymentAlreadyExists`] — a payment with `order_id` already exists.
    /// * [`PaymentError::MerchantNotFound`] — no merchant registered at `merchant_address`.
    /// * [`PaymentError::MerchantInactive`] — the merchant has been deactivated.
    /// * [`PaymentError::InvalidNonce`] — `nonce` does not match the expected value.
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
        require_not_paused(&env)?;
        payer.require_auth();
        require_positive(amount)?;
        require_valid_id(&order_id)?;
        validate_tags(&tags)?;

        // Replay-protection: nonce must equal the stored value
        let expected = storage::get_nonce(&env, &payer);
        if nonce != expected {
            return Err(PaymentError::InvalidNonce);
        }

        if !storage::is_token_allowed(&env, &token_address) {
            return Err(PaymentError::TokenNotAllowed);
        }

        if storage::get_payment(&env, &order_id).is_some() {
            return Err(PaymentError::PaymentAlreadyExists);
        }

        let merchant =
            storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)?;
        if !merchant.active {
            return Err(PaymentError::MerchantInactive);
        }

        // Advance nonce before any external calls
        storage::increment_nonce(&env, &payer);

        // Transfer tokens from payer to merchant (minus platform fee)
        let token_client = token::Client::new(&env, &token_address);
        let fee_bps = storage::get_platform_fee_bps(&env);
        let platform_fee: i128 = if fee_bps > 0 {
            amount * (fee_bps as i128) / 10_000
        } else {
            0
        };
        let merchant_amount = amount - platform_fee;
        token_client.transfer(&payer, &merchant_address, &merchant_amount);
        if platform_fee > 0 {
            if let Some(recipient) = storage::get_fee_recipient(&env) {
                token_client.transfer(&payer, &recipient, &platform_fee);
            }
        }

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
            platform_fee,
        };

        storage::set_payment(&env, &payment);
        storage::add_merchant_payment_id(&env, &merchant_address, &order_id)?;
        storage::add_payer_payment_id(&env, &payer, &order_id)?;

        // Update merchant total
        let mut m = merchant;
        m.total_received += amount;
        storage::set_merchant(&env, &m);

        // Update merchant stats
        let mut merchant_stats = storage::get_merchant_stats(&env, &merchant_address);
        merchant_stats.total_payments += 1;
        merchant_stats.total_volume = merchant_stats.total_volume.saturating_add(amount);
        storage::set_merchant_stats(&env, &merchant_address, &merchant_stats);

        // Update global stats
        let mut stats = storage::get_global_stats(&env);
        stats.total_payments += 1;
        stats.total_volume = stats.total_volume.saturating_add(amount);
        storage::set_global_stats(&env, &stats);

        // Check for suspicious activity
        let threshold = storage::get_large_payment_threshold(&env);
        if amount >= threshold {
            env.events().publish(
                ("lumenflow", "suspicious_activity"),
                (
                    SuspiciousActivityReason::LargePayment,
                    payer.clone(),
                    amount,
                ),
            );
        }

        env.events().publish(
            ("lumenflow", "payment_processed"),
            (order_id, payer, merchant_address, amount),
        );
        Ok(())
    }

    /// Return the current (next expected) nonce for `payer`.
    ///
    /// Payers should call this before constructing a `process_payment_with_nonce`
    /// transaction to obtain the exact nonce value the contract expects. The nonce
    /// starts at 0 for new accounts and increments by 1 on every accepted call.
    ///
    /// # Arguments
    /// * `payer` - The address whose nonce is queried.
    ///
    /// # Returns
    /// The u64 nonce value. Returns 0 if the payer has never submitted a nonce payment.
    pub fn get_payer_nonce(env: Env, payer: Address) -> u64 {
        storage::get_nonce(&env, &payer)
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
        require_not_paused(&env)?;
        payer.require_auth();
        if payments.len() > 10 {
            return Err(PaymentError::BatchSizeExceeded);
        }

        // Check for intra-batch duplicate order IDs before doing any work
        let mut seen: Vec<String> = Vec::new(&env);
        for item in payments.iter() {
            require_positive(item.amount)?;
            require_valid_id(&item.order_id)?;

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

            // Reject disallowed tokens
            if !storage::is_token_allowed(&env, &item.token_address) {
                return Err(PaymentError::TokenNotAllowed);
            }

            // Build payload: order_id bytes + amount bytes
            let mut payload = Bytes::new(&env);
            let network_id_bytes: Bytes = env.ledger().network_id().into();
            payload.append(&network_id_bytes);
            payload.append(&env.current_contract_address().to_xdr(&env));
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
                platform_fee: 0,
            };

            storage::set_payment(&env, &payment);
            storage::add_merchant_payment_id(&env, &item.merchant_address, &item.order_id)?;
            storage::add_payer_payment_id(&env, &payer, &item.order_id)?;

            // Update merchant total
            let mut m = merchant;
            m.total_received += item.amount;
            storage::set_merchant(&env, &m);

            // Update merchant stats
            let mut merchant_stats = storage::get_merchant_stats(&env, &item.merchant_address);
            merchant_stats.total_payments += 1;
            merchant_stats.total_volume = merchant_stats.total_volume.saturating_add(item.amount);
            storage::set_merchant_stats(&env, &item.merchant_address, &merchant_stats);

            // Update global stats
            let mut stats = storage::get_global_stats(&env);
            stats.total_payments += 1;
            stats.total_volume = stats.total_volume.saturating_add(item.amount);
            storage::set_global_stats(&env, &stats);

            env.events().publish(
                ("lumenflow", "payment_processed"),
                (
                    item.order_id,
                    payer.clone(),
                    item.merchant_address,
                    item.amount,
                ),
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
        let payment = storage::get_payment(&env, &order_id).ok_or(PaymentError::PaymentNotFound)?;

        let is_admin = storage::get_admin(&env).map_or(false, |a| a == caller);
        if !is_admin && caller != payment.payer && caller != payment.merchant_address {
            return Err(PaymentError::Unauthorized);
        }
        Ok(payment)
    }

    /// Get a public summary of a payment by order ID. No auth required.
    pub fn get_payment_summary(env: Env, order_id: String) -> Result<PaymentSummary, PaymentError> {
        let payment = storage::get_payment(&env, &order_id).ok_or(PaymentError::PaymentNotFound)?;

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
        require_not_paused(&env)?;
        let mut payment =
            storage::get_payment(&env, &order_id).ok_or(PaymentError::PaymentNotFound)?;

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
        require_not_paused(&env)?;
        require_admin(&env, &admin)?;
        if storage::get_payment(&env, &order_id).is_none() {
            return Err(PaymentError::PaymentNotFound);
        }
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
        require_not_paused(&env)?;
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
        date_start: Option<u64>,
        date_end: Option<u64>,
    ) -> Result<GlobalStats, PaymentError> {
        require_admin(&env, &admin)?;

        // Validate bounds when both are present.
        if let (Some(start), Some(end)) = (date_start, date_end) {
            if start > end {
                return Err(PaymentError::InvalidInput);
            }
        }

        // No filter → return cached all-time stats (fast path).
        if date_start.is_none() && date_end.is_none() {
            return Ok(storage::get_global_stats(&env));
        }

        // Filtered path: iterate every payment and aggregate within the window.
        let mut stats = GlobalStats {
            total_payments: 0,
            total_volume: 0,
            total_refunds: 0,
            total_refund_volume: 0,
            active_merchants: storage::get_global_stats(&env).active_merchants,
        };

        for merchant_addr in storage::get_merchant_list(&env).iter() {
            for order_id in storage::get_merchant_payment_ids(&env, &merchant_addr).iter() {
                if let Some(payment) = storage::get_payment(&env, &order_id) {
                    let ts = payment.paid_at;
                    if date_start.map_or(true, |s| ts >= s) && date_end.map_or(true, |e| ts <= e) {
                        stats.total_payments += 1;
                        stats.total_volume = stats.total_volume.saturating_add(payment.amount);
                        if payment.refunded_amount > 0 {
                            stats.total_refunds += 1;
                            stats.total_refund_volume = stats
                                .total_refund_volume
                                .saturating_add(payment.refunded_amount);
                        }
                    }
                }
            }
        }

        Ok(stats)
    }

    /// Get payment statistics for a specific merchant.
    pub fn get_merchant_stats(
        env: Env,
        merchant: Address,
    ) -> Result<MerchantStats, PaymentError> {
        merchant.require_auth();
        Ok(storage::get_merchant_stats(&env, &merchant))
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
        require_not_paused(&env)?;
        caller.require_auth();
        require_positive(amount)?;
        require_min_refund_amount(&env, amount)?;
        require_valid_id(&refund_id)?;

        if storage::get_refund(&env, &refund_id).is_some() {
            return Err(PaymentError::RefundAlreadyExists);
        }

        let payment = storage::get_payment(&env, &order_id).ok_or(PaymentError::PaymentNotFound)?;

        // Only payer or merchant may initiate
        if caller != payment.payer && caller != payment.merchant_address {
            return Err(PaymentError::Unauthorized);
        }

        // Refund window check
        let now = env.ledger().timestamp();
        let refund_window = storage::get_refund_window(&env);
        if now > payment.paid_at + refund_window {
            return Err(PaymentError::RefundWindowExpired);
        }

        // Amount check
        if payment.refunded_amount + amount > payment.amount {
            return Err(PaymentError::RefundExceedsOriginal);
        }

        // Minimum refund amount check
        let min_refund = storage::get_min_refund_amount(&env);
        if min_refund > 0 && amount < min_refund {
            return Err(PaymentError::RefundBelowMinimum);
        }

        let refund = RefundRecord {
            refund_id: refund_id.clone(),
            order_id: order_id.clone(),
            initiator: caller,
            amount,
            reason,
            status: RefundStatus::Pending,
            created_at: now,
        };
        storage::set_refund(&env, &refund);
        storage::add_order_refund_id(&env, &order_id, &refund_id);

        env.events()
            .publish(("lumenflow", "refund_initiated"), refund_id);
        Ok(())
    }

    /// List all refunds for an order. Caller must be payer, merchant, or admin.
    pub fn get_refunds_for_order(
        env: Env,
        caller: Address,
        order_id: String,
    ) -> Result<Vec<RefundRecord>, PaymentError> {
        caller.require_auth();
        let payment = storage::get_payment(&env, &order_id)
            .ok_or(PaymentError::PaymentNotFound)?;

        let is_admin = storage::get_admin(&env).map_or(false, |a| a == caller);
        if !is_admin && caller != payment.payer && caller != payment.merchant_address {
            return Err(PaymentError::Unauthorized);
        }

        let refund_ids = storage::get_order_refund_ids(&env, &order_id);
        let mut refunds: Vec<RefundRecord> = Vec::new(&env);
        for id in refund_ids.iter() {
            if let Some(refund) = storage::get_refund(&env, &id) {
                refunds.push_back(refund);
            }
        }
        Ok(refunds)
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
        require_not_paused(&env)?;
        let refund = storage::get_refund(&env, &refund_id).ok_or(PaymentError::RefundNotFound)?;
        let payment =
            storage::get_payment(&env, &refund.order_id).ok_or(PaymentError::PaymentNotFound)?;

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
    pub fn reject_refund(env: Env, caller: Address, refund_id: String) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        let refund = storage::get_refund(&env, &refund_id).ok_or(PaymentError::RefundNotFound)?;
        let payment =
            storage::get_payment(&env, &refund.order_id).ok_or(PaymentError::PaymentNotFound)?;

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
        require_not_paused(&env)?;
        let refund = storage::get_refund(&env, &refund_id).ok_or(PaymentError::RefundNotFound)?;

        if !matches!(refund.status, RefundStatus::Approved) {
            return Err(PaymentError::RefundNotApproved);
        }

        let mut payment =
            storage::get_payment(&env, &refund.order_id).ok_or(PaymentError::PaymentNotFound)?;

        // Merchant must authorise the transfer
        payment.merchant_address.require_auth();

        // Effects: update all internal state before external interaction (checks-effects-interactions)
        let refund_amount = refund.amount;

        payment.refunded_amount += refund_amount;
        payment.status = if payment.refunded_amount >= payment.amount {
            PaymentStatus::FullyRefunded
        } else {
            PaymentStatus::PartiallyRefunded
        };
        storage::set_payment(&env, &payment);

        let mut r = refund;
        r.status = RefundStatus::Completed;
        storage::set_refund(&env, &r);

        // Update merchant stats
        let mut merchant_stats = storage::get_merchant_stats(&env, &payment.merchant_address);
        merchant_stats.total_refunds += 1;
        merchant_stats.total_refund_volume = merchant_stats.total_refund_volume.saturating_add(r.amount);
        storage::set_merchant_stats(&env, &payment.merchant_address, &merchant_stats);

        let mut stats = storage::get_global_stats(&env);
        stats.total_refunds += 1;
        stats.total_refund_volume = stats.total_refund_volume.saturating_add(refund_amount);
        storage::set_global_stats(&env, &stats);

        // Interaction: external token transfer happens after all state changes
        let token_client = token::Client::new(&env, &payment.token);
        token_client.transfer(&payment.merchant_address, &payment.payer, &refund_amount);

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
        expires_at: Option<u64>,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        initiator.require_auth();
        require_positive(amount)?;
        require_valid_id(&payment_id)?;

        // Validate multisig configuration
        if signers.len() == 0 {
            return Err(PaymentError::InvalidInput);
        }
        if required_signatures == 0 {
            return Err(PaymentError::InvalidInput);
        }
        if required_signatures > signers.len() {
            return Err(PaymentError::InvalidInput);
        }

        if !storage::is_token_allowed(&env, &token_address) {
            return Err(PaymentError::TokenNotAllowed);
        }

        if storage::get_multisig(&env, &payment_id).is_some() {
            return Err(PaymentError::PaymentAlreadyExists);
        }

        let merchant =
            storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)?;
        if !merchant.active {
            return Err(PaymentError::MerchantInactive);
        }

        let now = env.ledger().timestamp();
        let resolved_expires_at =
            Some(expires_at.unwrap_or_else(|| {
                now.saturating_add(storage::get_multisig_expiry_duration(&env))
            }));

        let ms = MultisigPayment {
            payment_id: payment_id.clone(),
            initiator: initiator.clone(),
            merchant_address,
            token: token_address,
            amount,
            required_signatures,
            signers,
            collected: Vec::new(&env),
            executed: false,
            cancelled: false,
            created_at: now,
            expires_at: resolved_expires_at,
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
        require_not_paused(&env)?;
        signer.require_auth();
        let mut ms =
            storage::get_multisig(&env, &payment_id).ok_or(PaymentError::MultisigNotFound)?;

        if ms.executed {
            return Err(PaymentError::MultisigAlreadyExecuted);
        }

        if ms.cancelled {
            return Err(PaymentError::MultisigCancelled);
        }

        if env.ledger().timestamp() >= ms.expires_at.unwrap_or(u64::MAX) {
            return Err(PaymentError::MultisigExpired);
        }

        // Verify signer is in the allowed list
        if !ms.signers.contains(&signer) {
            return Err(PaymentError::Unauthorized);
        }

        // Prevent double-signing: check if this signer has already signed
        if ms.collected.iter().any(|e| e.signer == signer) {
            return Err(PaymentError::MultisigAlreadySigned);
        }

        ms.collected.push_back(SignatureEntry { signer, signature });
        storage::set_multisig(&env, &ms);
        Ok(())
    }

    /// Cancel a multisig payment. Initiator or admin only.
    pub fn cancel_multisig_payment(
        env: Env,
        caller: Address,
        payment_id: String,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        let mut ms =
            storage::get_multisig(&env, &payment_id).ok_or(PaymentError::MultisigNotFound)?;

        if ms.executed {
            return Err(PaymentError::MultisigAlreadyExecuted);
        }
        if ms.cancelled {
            return Err(PaymentError::MultisigAlreadyCancelled);
        }

        let is_admin = storage::get_admin(&env).map_or(false, |a| a == caller);
        if !is_admin && caller != ms.initiator {
            return Err(PaymentError::Unauthorized);
        }

        ms.cancelled = true;
        storage::set_multisig(&env, &ms);
        Ok(())
    }

    /// Get a multisig payment record. Initiator, any listed signer, or admin.
    pub fn get_multisig_payment(
        env: Env,
        caller: Address,
        payment_id: String,
    ) -> Result<MultisigPayment, PaymentError> {
        caller.require_auth();
        let ms =
            storage::get_multisig(&env, &payment_id).ok_or(PaymentError::MultisigNotFound)?;

        let is_admin = storage::get_admin(&env).map_or(false, |a| a == caller);
        if !is_admin && caller != ms.initiator && !ms.signers.contains(&caller) && caller != ms.merchant_address {
            return Err(PaymentError::Unauthorized);
        }
        Ok(ms)
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
        require_not_paused(&env)?;
        payer.require_auth();
        let mut ms =
            storage::get_multisig(&env, &payment_id).ok_or(PaymentError::MultisigNotFound)?;

        if ms.executed {
            return Err(PaymentError::MultisigAlreadyExecuted);
        }

        if ms.cancelled {
            return Err(PaymentError::MultisigAlreadyCancelled);
        }

        if let Some(expires_at) = ms.expires_at {
            if env.ledger().timestamp() > expires_at {
                return Err(PaymentError::PaymentExpired);
            }
        }

        if ms.collected.len() < ms.required_signatures {
            return Err(PaymentError::InsufficientSignatures);
        }

        let token_client = token::Client::new(&env, &ms.token);
        token_client.transfer(&payer, &ms.merchant_address, &ms.amount);

        ms.executed = true;
        storage::set_multisig(&env, &ms);

        // Record in payment history
        let now = env.ledger().timestamp();
        let payment = PaymentOrder {
            order_id: payment_id.clone(),
            merchant_address: ms.merchant_address.clone(),
            payer: payer.clone(),
            token: ms.token.clone(),
            amount: ms.amount,
            status: PaymentStatus::Completed,
            paid_at: now,
            refunded_amount: 0,
            memo: String::from_str(&env, ""),
            tags: None,
            platform_fee: 0,
        };
        storage::set_payment(&env, &payment);
        let _ = storage::add_merchant_payment_id(&env, &ms.merchant_address, &payment_id);
        let _ = storage::add_payer_payment_id(&env, &payer, &payment_id);

        let mut stats = storage::get_global_stats(&env);
        stats.total_payments += 1;
        stats.total_volume = stats.total_volume.saturating_add(ms.amount);
        storage::set_global_stats(&env, &stats);

        env.events()
            .publish(("lumenflow", "multisig_executed"), payment_id);
        Ok(())
    }

    // ── Versioning ────────────────────────────────────────────────────────────

    /// Admin: record the current binary version on-chain (call once after deploy/upgrade).
    pub fn set_contract_version(env: Env, admin: Address) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        let version = String::from_str(&env, env!("CARGO_PKG_VERSION"));
        storage::set_stored_version(&env, &version);
        Ok(())
    }

    /// Admin guard: returns error if stored on-chain version does not match binary version.
    pub fn assert_version_matches(env: Env, admin: Address) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        let current = String::from_str(&env, env!("CARGO_PKG_VERSION"));
        if let Some(stored) = storage::get_stored_version(&env) {
            if stored != current {
                return Err(PaymentError::VersionMismatch);
            }
        }
        Ok(())
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// List merchants with cursor-based pagination. Admin only.
    pub fn get_merchants(
        env: Env,
        admin: Address,
        cursor: Option<Address>,
        limit: u32,
    ) -> Result<MerchantPage, PaymentError> {
        require_admin(&env, &admin)?;
        require_valid_limit(limit)?;
        let addresses = storage::get_merchant_list(&env);
        Self::build_merchant_page(&env, addresses, cursor, limit)
    }

    fn build_merchant_page(
        env: &Env,
        addresses: Vec<Address>,
        cursor: Option<Address>,
        limit: u32,
    ) -> Result<MerchantPage, PaymentError> {
        let mut merchants: Vec<Merchant> = Vec::new(env);
        let mut skip = cursor.is_some();

        for addr in addresses.iter() {
            if skip {
                if cursor.as_ref() == Some(&addr) {
                    skip = false;
                }
                continue;
            }
            if let Some(m) = storage::get_merchant(env, &addr) {
                merchants.push_back(m);
            }
        }

        let total = merchants.len();
        let mut result: Vec<Merchant> = Vec::new(env);
        let mut next_cursor: Option<Address> = None;

        for (i, m) in merchants.iter().enumerate() {
            if i as u32 >= limit {
                next_cursor = Some(m.address.clone());
                break;
            }
            result.push_back(m.clone());
        }

        Ok(MerchantPage {
            merchants: result,
            next_cursor,
            total,
        })
    }

    fn build_page(
        env: &Env,
        ids: Vec<String>,
        cursor: Option<String>,
        limit: u32,
        filter: Option<PaymentFilter>,
        sort_field: SortField,
        sort_order: SortOrder,
    ) -> Result<PaymentPage, PaymentError> {
        // Single pass: load and filter all candidate payments.
        // Storage reads are the dominant gas cost; we avoid re-reading any record.
        let mut payments: Vec<PaymentOrder> = Vec::new(env);
        for id in ids.iter() {
            if let Some(p) = storage::get_payment(env, &id) {
                if Self::matches_filter(&p, &filter) {
                    payments.push_back(p);
                }
            }
        }

        // Sort — O(n log n) via alloc::vec::Vec::sort_unstable_by.
        //
        // The previous insertion sort was O(n²) in both time and Soroban
        // instruction count: each insertion rebuilt the entire soroban_sdk::Vec,
        // causing O(n) element copies per item. For a merchant with N payments
        // this consumed O(n²) instructions, exhausting Soroban's per-transaction
        // limit for datasets of ~1 000+ entries.
        //
        // The new approach:
        //   1. Collect into a native alloc::vec::Vec (one pass, O(n)).
        //   2. Sort in-place with sort_unstable_by (O(n log n), no extra alloc).
        //   3. Rebuild the soroban_sdk::Vec from the sorted slice (one pass, O(n)).
        //
        // alloc::vec::Vec is available because soroban-sdk is compiled with the
        // "alloc" feature, which re-exports the global allocator for no_std WASM.
        let mut native: alloc::vec::Vec<PaymentOrder> = payments.iter().collect();
        native.sort_unstable_by(|a, b| {
            let cmp = match sort_field {
                SortField::Date => a.paid_at.cmp(&b.paid_at),
                SortField::Amount => a.amount.cmp(&b.amount),
            };
            match sort_order {
                SortOrder::Ascending => cmp,
                SortOrder::Descending => cmp.reverse(),
            }
        });
        let mut sorted: Vec<PaymentOrder> = Vec::new(env);
        for p in native {
            sorted.push_back(p);
        }

        let total_matching = sorted.len();
        let mut result: Vec<PaymentOrder> = Vec::new(env);
        let mut next_cursor: Option<String> = None;

        // Apply cursor: skip all entries up to and including the cursor record
        let start_idx = if let Some(ref cursor_id) = cursor {
            sorted.iter().position(|p| p.order_id == *cursor_id)
                .map(|pos| pos + 1)
                .unwrap_or(0)
        } else {
            0
        };

        for (count, i) in (start_idx..sorted.len() as usize).enumerate() {
            if count as u32 >= limit {
                // There are more results — set next_cursor to the last included id
                next_cursor = result.last().map(|p| p.order_id.clone());
                break;
            }
            if let Some(p) = sorted.get(i as u32) {
                result.push_back(p);
            }
        }

        Ok(PaymentPage {
            payments: result,
            next_cursor,
            total_matching,
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
        require_not_paused(&env)?;
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
        require_not_paused(&env)?;
        payer.require_auth();

        let pr =
            storage::get_payment_request(&env, &request_id).ok_or(PaymentError::PaymentNotFound)?;

        if env.ledger().timestamp() > pr.expires_at {
            storage::remove_payment_request(&env, &request_id);
            return Err(PaymentError::PaymentExpired);
        }

        // Prevent creating a duplicate payment record for this order ID
        if storage::get_payment(&env, &request_id).is_some() {
            return Err(PaymentError::PaymentAlreadyExists);
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
            platform_fee: 0,
        };

        storage::set_payment(&env, &payment);
        storage::add_merchant_payment_id(&env, &pr.merchant, &pr.request_id)?;
        storage::add_payer_payment_id(&env, &payer, &pr.request_id)?;

        // Update stats
        let mut stats = storage::get_global_stats(&env);
        stats.total_payments += 1;
        stats.total_volume = stats.total_volume.saturating_add(pr.amount);
        storage::set_global_stats(&env, &stats);

        // Remove the request as it's paid
        storage::remove_payment_request(&env, &request_id);

        env.events()
            .publish(("lumenflow", "payment_request_paid"), request_id);
        Ok(())
    }

    // -- Subscriptions ---------------------------------------------------------

    /// Create a subscription plan that subscribers can later subscribe to.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address. Must sign the call.
    /// * `plan_id` - Unique, non-empty identifier for the plan (max 64 chars).
    /// * `token` - Allowed token contract address used for recurring charges.
    /// * `amount` - Positive token amount charged per billing cycle.
    /// * `interval_secs` - Seconds that must elapse between charges. Must be non-zero.
    /// * `max_cycles` - Maximum number of charges. Must be non-zero.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] - `admin` is not the configured administrator.
    /// * [`PaymentError::InvalidInput`] - `plan_id` is empty or too long, or
    ///   `interval_secs` or `max_cycles` is zero.
    /// * [`PaymentError::InvalidAmount`] - `amount` is not positive.
    /// * [`PaymentError::TokenNotAllowed`] - `token` is not on the allow-list.
    /// * [`PaymentError::SubscriptionPlanAlreadyExists`] - a plan with `plan_id`
    ///   already exists.
    pub fn create_subscription_plan(
        env: Env,
        admin: Address,
        plan_id: String,
        token: Address,
        amount: i128,
        interval_secs: u64,
        max_cycles: u32,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        require_admin(&env, &admin)?;
        require_valid_id(&plan_id)?;
        require_positive(amount)?;
        if interval_secs == 0 || max_cycles == 0 {
            return Err(PaymentError::InvalidInput);
        }
        if !storage::is_token_allowed(&env, &token) {
            return Err(PaymentError::TokenNotAllowed);
        }
        if storage::get_subscription_plan(&env, &plan_id).is_some() {
            return Err(PaymentError::SubscriptionPlanAlreadyExists);
        }

        let plan = SubscriptionPlan {
            plan_id: plan_id.clone(),
            token,
            amount,
            interval_secs,
            max_cycles,
            created_at: env.ledger().timestamp(),
        };
        storage::set_subscription_plan(&env, &plan);

        env.events()
            .publish(("lumenflow", "subscription_plan_created"), plan_id);
        Ok(())
    }

    /// Subscribe `subscriber` to an existing plan, billed to `merchant`.
    ///
    /// The subscriber grants the contract a token allowance up front covering
    /// every remaining cycle of this and any other of their active
    /// subscriptions in the plan's token, so charges normally need no further
    /// subscriber signature. The allowance expiry is capped by the network's
    /// maximum entry TTL, which can be shorter than a long subscription's
    /// lifetime; the subscriber refreshes it with
    /// [`Self::renew_subscription_allowance`]. The first charge becomes due one
    /// full interval after subscribing.
    ///
    /// # Arguments
    /// * `merchant` - Registered, active merchant that will receive the charges.
    /// * `subscriber` - Address to be charged each cycle. Must sign the call.
    /// * `plan_id` - Identifier of an existing subscription plan.
    /// * `subscription_id` - Unique, non-empty identifier for this subscription.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidInput`] - `subscription_id` is empty or too long.
    /// * [`PaymentError::SubscriptionPlanNotFound`] - no plan exists with `plan_id`.
    /// * [`PaymentError::SubscriptionAlreadyExists`] - a subscription with
    ///   `subscription_id` already exists.
    /// * [`PaymentError::MerchantNotFound`] - no merchant registered at `merchant`.
    /// * [`PaymentError::MerchantInactive`] - the merchant has been deactivated.
    pub fn subscribe(
        env: Env,
        merchant: Address,
        subscriber: Address,
        plan_id: String,
        subscription_id: String,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        subscriber.require_auth();
        require_valid_id(&subscription_id)?;

        let plan = storage::get_subscription_plan(&env, &plan_id)
            .ok_or(PaymentError::SubscriptionPlanNotFound)?;
        if storage::get_subscription(&env, &subscription_id).is_some() {
            return Err(PaymentError::SubscriptionAlreadyExists);
        }

        let m = storage::get_merchant(&env, &merchant).ok_or(PaymentError::MerchantNotFound)?;
        if !m.active {
            return Err(PaymentError::MerchantInactive);
        }

        let now = env.ledger().timestamp();
        let sub = Subscription {
            subscription_id: subscription_id.clone(),
            plan_id,
            merchant: merchant.clone(),
            subscriber: subscriber.clone(),
            status: SubscriptionStatus::Active,
            cycles_charged: 0,
            last_charged_at: now,
            created_at: now,
        };
        storage::set_subscription(&env, &sub);

        // SEP-41 approve SETS the (from, spender) allowance rather than adding
        // to it, so the approved amount must cover the combined remaining
        // cycles of every active subscription the subscriber has in this token.
        // That running total is tracked in the reserve key.
        let total = plan.amount.saturating_mul(plan.max_cycles as i128);
        let reserve =
            storage::get_subscription_reserve(&env, &subscriber, &plan.token).saturating_add(total);
        storage::set_subscription_reserve(&env, &subscriber, &plan.token, reserve);
        let token_client = token::Client::new(&env, &plan.token);
        token_client.approve(
            &subscriber,
            &env.current_contract_address(),
            &reserve,
            &env.ledger().max_live_until_ledger(),
        );

        env.events().publish(
            ("lumenflow", "subscription_created"),
            (subscription_id, subscriber, merchant),
        );
        Ok(())
    }

    /// Charge one billing cycle of an active subscription.
    ///
    /// Transfers the plan amount from the subscriber to the merchant only if the
    /// billing interval has elapsed since the last charge (or since subscribing)
    /// and the subscription has cycles remaining. The transfer draws on the
    /// allowance granted at subscribe time. Reaching `max_cycles` marks the
    /// subscription `Completed`.
    ///
    /// # Arguments
    /// * `merchant` - Must be the merchant on the subscription. Must sign the call.
    /// * `subscription_id` - Identifier of the subscription to charge.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::SubscriptionNotFound`] - no subscription exists with
    ///   `subscription_id`.
    /// * [`PaymentError::Unauthorized`] - `merchant` is not the subscription's merchant.
    /// * [`PaymentError::SubscriptionNotActive`] - the subscription was cancelled.
    /// * [`PaymentError::SubscriptionPlanNotFound`] - the underlying plan record
    ///   no longer exists.
    /// * [`PaymentError::TokenNotAllowed`] - the plan's token has since been
    ///   removed from the allow-list.
    /// * [`PaymentError::MerchantNotFound`] - the merchant record no longer exists.
    /// * [`PaymentError::MerchantInactive`] - the merchant has been deactivated.
    /// * [`PaymentError::SubscriptionMaxCyclesReached`] - all cycles have been charged.
    /// * [`PaymentError::SubscriptionIntervalNotElapsed`] - the billing interval
    ///   has not yet elapsed.
    pub fn charge_subscription(
        env: Env,
        merchant: Address,
        subscription_id: String,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        merchant.require_auth();

        let mut sub = storage::get_subscription(&env, &subscription_id)
            .ok_or(PaymentError::SubscriptionNotFound)?;
        if merchant != sub.merchant {
            return Err(PaymentError::Unauthorized);
        }
        if matches!(sub.status, SubscriptionStatus::Cancelled) {
            return Err(PaymentError::SubscriptionNotActive);
        }

        let plan = storage::get_subscription_plan(&env, &sub.plan_id)
            .ok_or(PaymentError::SubscriptionPlanNotFound)?;

        // Re-checked at charge time, matching the one-off payment paths: an
        // admin deactivating the merchant or delisting the token must also
        // stop recurring charges.
        if !storage::is_token_allowed(&env, &plan.token) {
            return Err(PaymentError::TokenNotAllowed);
        }
        let m = storage::get_merchant(&env, &sub.merchant).ok_or(PaymentError::MerchantNotFound)?;
        if !m.active {
            return Err(PaymentError::MerchantInactive);
        }

        // Checked before the Completed status so an exhausted subscription
        // reports MaxCyclesReached rather than the generic NotActive.
        if sub.cycles_charged >= plan.max_cycles {
            return Err(PaymentError::SubscriptionMaxCyclesReached);
        }

        let now = env.ledger().timestamp();
        if now < sub.last_charged_at.saturating_add(plan.interval_secs) {
            return Err(PaymentError::SubscriptionIntervalNotElapsed);
        }

        // Effects before interaction (checks-effects-interactions)
        sub.cycles_charged += 1;
        sub.last_charged_at = now;
        if sub.cycles_charged >= plan.max_cycles {
            sub.status = SubscriptionStatus::Completed;
        }
        storage::set_subscription(&env, &sub);

        // transfer_from consumes the allowance; keep the reserve in step
        let reserve = storage::get_subscription_reserve(&env, &sub.subscriber, &plan.token)
            .saturating_sub(plan.amount);
        storage::set_subscription_reserve(&env, &sub.subscriber, &plan.token, reserve);

        let token_client = token::Client::new(&env, &plan.token);
        token_client.transfer_from(
            &env.current_contract_address(),
            &sub.subscriber,
            &sub.merchant,
            &plan.amount,
        );

        env.events().publish(
            ("lumenflow", "subscription_charged"),
            (subscription_id, sub.cycles_charged, plan.amount),
        );
        Ok(())
    }

    /// Cancel an active subscription. No further charges are possible.
    ///
    /// The uncharged cycles are released from the subscriber's tracked reserve.
    /// When the subscriber is the caller, the token allowance is also
    /// re-approved down to the reserve still backing their other active
    /// subscriptions (zero if none). A merchant-initiated cancel cannot shrink
    /// the allowance (approve needs the subscriber's auth); the subscriber
    /// clears the residual with [`Self::renew_subscription_allowance`].
    ///
    /// # Arguments
    /// * `caller` - Must be the subscription's merchant or subscriber. Must sign
    ///   the call.
    /// * `subscription_id` - Identifier of the subscription to cancel.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::SubscriptionNotFound`] - no subscription exists with
    ///   `subscription_id`.
    /// * [`PaymentError::Unauthorized`] - `caller` is neither the merchant nor
    ///   the subscriber.
    /// * [`PaymentError::SubscriptionNotActive`] - the subscription is already
    ///   cancelled or completed.
    /// * [`PaymentError::SubscriptionPlanNotFound`] - the underlying plan record
    ///   no longer exists.
    pub fn cancel_subscription(
        env: Env,
        caller: Address,
        subscription_id: String,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        caller.require_auth();

        let mut sub = storage::get_subscription(&env, &subscription_id)
            .ok_or(PaymentError::SubscriptionNotFound)?;
        if caller != sub.merchant && caller != sub.subscriber {
            return Err(PaymentError::Unauthorized);
        }
        if !matches!(sub.status, SubscriptionStatus::Active) {
            return Err(PaymentError::SubscriptionNotActive);
        }

        let plan = storage::get_subscription_plan(&env, &sub.plan_id)
            .ok_or(PaymentError::SubscriptionPlanNotFound)?;

        sub.status = SubscriptionStatus::Cancelled;
        storage::set_subscription(&env, &sub);

        let remaining = plan
            .amount
            .saturating_mul((plan.max_cycles - sub.cycles_charged) as i128);
        let reserve = storage::get_subscription_reserve(&env, &sub.subscriber, &plan.token)
            .saturating_sub(remaining);
        storage::set_subscription_reserve(&env, &sub.subscriber, &plan.token, reserve);

        // Shrinking the allowance needs the subscriber's auth, so it can only
        // happen on subscriber-initiated cancels.
        if caller == sub.subscriber {
            token::Client::new(&env, &plan.token).approve(
                &sub.subscriber,
                &env.current_contract_address(),
                &reserve,
                &env.ledger().max_live_until_ledger(),
            );
        }

        env.events().publish(
            ("lumenflow", "subscription_cancelled"),
            (subscription_id, caller),
        );
        Ok(())
    }

    /// Re-approve the contract's token allowance to exactly the reserve backing
    /// `subscriber`'s active subscriptions in `token` (zero if none).
    ///
    /// Two uses: refreshing the allowance expiry, which is capped by the
    /// network's maximum entry TTL and can lapse before a long subscription
    /// finishes, and clearing residual allowance left behind by a
    /// merchant-initiated cancel.
    ///
    /// # Arguments
    /// * `subscriber` - Owner of the allowance. Must sign the call.
    /// * `token` - Token contract the allowance is held in.
    ///
    /// # Returns
    /// `Ok(())` on success.
    pub fn renew_subscription_allowance(
        env: Env,
        subscriber: Address,
        token: Address,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        subscriber.require_auth();

        let reserve = storage::get_subscription_reserve(&env, &subscriber, &token);
        token::Client::new(&env, &token).approve(
            &subscriber,
            &env.current_contract_address(),
            &reserve,
            &env.ledger().max_live_until_ledger(),
        );
        Ok(())
    }

    /// Get a subscription plan by ID.
    ///
    /// # Errors
    /// * [`PaymentError::SubscriptionPlanNotFound`] - no plan exists with `plan_id`.
    pub fn get_subscription_plan(
        env: Env,
        plan_id: String,
    ) -> Result<SubscriptionPlan, PaymentError> {
        storage::get_subscription_plan(&env, &plan_id).ok_or(PaymentError::SubscriptionPlanNotFound)
    }

    /// Get a subscription by ID.
    ///
    /// # Errors
    /// * [`PaymentError::SubscriptionNotFound`] - no subscription exists with
    ///   `subscription_id`.
    pub fn get_subscription(
        env: Env,
        subscription_id: String,
    ) -> Result<Subscription, PaymentError> {
        storage::get_subscription(&env, &subscription_id).ok_or(PaymentError::SubscriptionNotFound)
    }
}
