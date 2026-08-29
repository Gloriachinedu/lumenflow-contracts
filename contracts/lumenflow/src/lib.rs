#![no_std]

extern crate alloc;

pub mod error;
mod helper;
mod storage;
pub mod types;

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_error_codes;

use soroban_sdk::{contract, contractimpl, token, xdr::ToXdr, Address, Bytes, Env, String, Vec};

use error::PaymentError;
use helper::{
    require_admin, require_admin_or, require_admin_rate_limited, require_min_refund_amount,
    require_non_empty_string, require_not_paused, require_positive, require_valid_id,
    require_valid_limit, validate_merchant_category, validate_tags, verify_signature,
};
use types::{
    BatchPaymentItem, EscrowRecord, EscrowStatus, GlobalStats, Merchant, MerchantCategory,
    MerchantPage, MerchantStats, MultisigPayment, PaymentFilter, PaymentOrder, PaymentPage,
    PaymentRequest, PaymentStatus, PaymentSummary, RefundRecord, RefundStatus, SignatureEntry,
    SortField, SortOrder, StatusFilter, Subscription, SubscriptionPlan, SubscriptionStatus,
    SuspiciousActivityReason,
};

// ── Contract ──────────────────────────────────────────────────────────────────

const MAX_REFUNDS_PER_PAYMENT: usize = 10;

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
        require_admin_rate_limited(&env, &admin)?;
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
        require_admin_rate_limited(&env, &admin)?;
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
        require_admin_rate_limited(&env, &admin)?;
        require_positive(threshold)?;
        storage::set_large_payment_threshold(&env, threshold);
        Ok(())
    }

    /// Add a token to the whitelist (admin only).
    pub fn add_allowed_token(env: Env, admin: Address, token: Address) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
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
        require_admin_rate_limited(&env, &admin)?;
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
        require_admin_rate_limited(&env, &admin)?;
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
        require_admin_rate_limited(&env, &admin)?;
        if window_secs < storage::MIN_REFUND_WINDOW_SECS {
            return Err(PaymentError::InvalidInput);
        }
        storage::set_refund_window(&env, window_secs);
        env.events().publish(("lumenflow", "refund_window_set"), window_secs);
        Ok(())
    }

    /// Pause the contract. All state-mutating functions will return ContractPaused. Admin only.
    pub fn pause_contract(env: Env, admin: Address) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
        storage::set_paused(&env, true);
        env.events().publish(("lumenflow", "contract_paused"), ());
        Ok(())
    }

    /// Unpause the contract. Admin only. Subject to a 7-day timelock when paused via pause_with_reason.
    pub fn unpause_contract(env: Env, admin: Address) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
        // Check timelock
        if let Some(lock_until) = storage::get_unpause_lock_until(&env) {
            if env.ledger().timestamp() < lock_until {
                return Err(PaymentError::TimelockActive);
            }
        }
        // Clear pause state
        storage::clear_unpause_lock_until(&env);
        storage::clear_pause_reason(&env);
        storage::clear_early_unpause_approvals(&env);
        storage::set_paused(&env, false);
        env.events().publish(("lumenflow", "contract_unpaused"), ());
        Ok(())
    }

    /// Pause the contract with a recorded reason and a 7-day unpause timelock.
    ///
    /// Unlike `pause_contract`, this function stores the human-readable `reason`
    /// on-chain and sets a timelock: `unpause_contract` will be blocked until
    /// 7 days after this call unless overridden by the 3-of-5 multisig guardian
    /// mechanism via `approve_early_unpause`.
    ///
    /// The reason and timelock expiry are emitted in the `contract_paused` event
    /// so that off-chain monitors can surface the pause context immediately.
    ///
    /// # Arguments
    /// * `admin` - Contract administrator. Must sign.
    /// * `reason` - Non-empty human-readable description of the pause cause.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — caller is not the admin.
    /// * [`PaymentError::InvalidInput`] — reason is empty.
    pub fn pause_with_reason(env: Env, admin: Address, reason: String) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
        require_non_empty_string(&reason)?;
        storage::set_paused(&env, true);
        storage::set_pause_reason(&env, &reason);
        let lock_until = env.ledger().timestamp() + PAUSE_TIMELOCK_SECS;
        storage::set_unpause_lock_until(&env, lock_until);
        storage::clear_early_unpause_approvals(&env);
        env.events()
            .publish(("lumenflow", "contract_paused"), (reason, lock_until));
        Ok(())
    }

    /// Register the 5 authorized pause guardians who can vote for early unpause.
    ///
    /// Exactly 5 guardian addresses must be supplied. Replaces any previous
    /// guardian list. Admin only.
    ///
    /// # Arguments
    /// * `admin` - Contract administrator. Must sign.
    /// * `guardians` - Exactly 5 unique guardian `Address` values.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — caller is not the admin.
    /// * [`PaymentError::InvalidInput`] — list is not exactly 5 addresses.
    pub fn set_pause_guardians(
        env: Env,
        admin: Address,
        guardians: Vec<Address>,
    ) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
        if guardians.len() != 5 {
            return Err(PaymentError::InvalidInput);
        }
        storage::set_pause_guardians(&env, &guardians);
        Ok(())
    }

    /// Vote to approve an early (pre-timelock) unpause of the contract.
    ///
    /// Each registered pause guardian may call this once per pause event. When
    /// the approval count reaches `EARLY_UNPAUSE_THRESHOLD` (3), the contract is
    /// automatically unpaused and the timelock, reason, and approval list are
    /// cleared.
    ///
    /// # Arguments
    /// * `guardian` - A registered pause guardian. Must sign.
    ///
    /// # Errors
    /// * [`PaymentError::NotAPauseGuardian`] — caller is not in the guardian list.
    /// * [`PaymentError::AlreadyApprovedUnpause`] — caller already voted.
    pub fn approve_early_unpause(env: Env, guardian: Address) -> Result<(), PaymentError> {
        guardian.require_auth();

        // Verify this caller is a registered guardian
        let guardians = storage::get_pause_guardians(&env);
        let mut is_guardian = false;
        for g in guardians.iter() {
            if g == guardian {
                is_guardian = true;
                break;
            }
        }
        if !is_guardian {
            return Err(PaymentError::NotAPauseGuardian);
        }

        // Check for duplicate approval
        let mut approvals = storage::get_early_unpause_approvals(&env);
        for a in approvals.iter() {
            if a == guardian {
                return Err(PaymentError::AlreadyApprovedUnpause);
            }
        }

        approvals.push_back(guardian.clone());
        storage::set_early_unpause_approvals(&env, &approvals);

        // If threshold reached, auto-unpause
        if approvals.len() >= EARLY_UNPAUSE_THRESHOLD {
            storage::set_paused(&env, false);
            storage::clear_unpause_lock_until(&env);
            storage::clear_pause_reason(&env);
            storage::clear_early_unpause_approvals(&env);
            env.events()
                .publish(("lumenflow", "contract_unpaused"), ("multisig_override",));
        }
        Ok(())
    }

    /// Set the minimum refund amount (default 100 stroops). Admin only.
    pub fn set_min_refund_amount(
        env: Env,
        admin: Address,
        amount: i128,
    ) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
        require_positive(amount)?;
        storage::set_min_refund_amount(&env, amount);
        Ok(())
    }

    /// Reset the auth failure lockout for a specific address (admin only).
    ///
    /// Clears both the failure counter and the lockout expiry for `address`.
    /// This allows an admin to manually intervene when a legitimate user is
    /// accidentally locked out, or to clear the lockout for an address after
    /// investigation.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `address` - The address whose lockout and failure counter should be cleared.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    ///
    /// # Example
    /// ```ignore
    /// stellar contract invoke \
    ///   --id $CONTRACT_ID \
    ///   --source-account $ADMIN_KEY \
    ///   --network testnet \
    ///   -- reset_auth_lockout \
    ///   --admin $ADMIN_ADDRESS \
    ///   --address $LOCKED_ADDRESS
    /// ```
    pub fn reset_auth_lockout(
        env: Env,
        admin: Address,
        address: Address,
    ) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
        storage::clear_auth_lockout(&env, &address);
        env.events().publish(("lumenflow", "auth_lockout_reset"), address);
        Ok(())
    }

    /// Set the per-merchant payment rate limit (max payments per 300-ledger window). Admin only.
    ///
    /// The rolling-window counter resets every 300 ledgers (~25 minutes). Once a
    /// merchant reaches the limit within a window all further `process_payment_with_signature`
    /// and `batch_payment` calls for that merchant are rejected with
    /// [`PaymentError::RateLimitExceeded`] until the next window begins.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `limit` - Maximum number of payments accepted per merchant per window. Must be > 0.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    /// * [`PaymentError::InvalidInput`] — `limit` is zero.
    pub fn set_rate_limit(env: Env, admin: Address, limit: u32) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
        if limit == 0 {
            return Err(PaymentError::InvalidInput);
        }
        storage::set_rate_limit_per_window(&env, limit);
        env.events().publish(("lumenflow", "rate_limit_set"), limit);
        Ok(())
    }

    // ── Token and issuer allowlist management ─────────────────────────────────

    /// Add a Stellar token address to the contract allowlist (admin only).
    ///
    /// `issuer` — optional issuer address for the token.  When the admin has
    /// registered at least one allowed issuer via `add_allowed_issuer`, this
    /// argument is mandatory and must match a registered issuer; otherwise the
    /// call is rejected with `InvalidIssuer`.  When no issuers have been
    /// registered the argument is ignored and any valid token may be added.
    pub fn add_allowed_token(
        env: Env,
        admin: Address,
        token: Address,
        issuer: Option<Address>,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;

        // If an issuer is supplied, verify it is on the approved-issuer list.
        if let Some(ref iss) = issuer {
            if !storage::is_issuer_allowed(&env, iss) {
                return Err(PaymentError::InvalidIssuer);
            }
        }

        storage::set_token_allowed(&env, &token, true);
        env.events().publish(("lumenflow", "token_allowed"), token);
        Ok(())
    }

    /// Remove a Stellar token address from the contract allowlist (admin only).
    ///
    /// Payments for a removed token will be rejected with `TokenNotAllowed`.
    /// Existing completed payments are not affected.
    pub fn remove_allowed_token(
        env: Env,
        admin: Address,
        token: Address,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        storage::set_token_allowed(&env, &token, false);
        env.events().publish(("lumenflow", "token_disallowed"), token);
        Ok(())
    }

    /// Register an issuer address as an approved token issuer (admin only).
    ///
    /// Once at least one issuer is registered, `add_allowed_token` validates
    /// that every new token's issuer is on this list before whitelisting.
    pub fn add_allowed_issuer(
        env: Env,
        admin: Address,
        issuer: Address,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        storage::set_issuer_allowed(&env, &issuer, true);
        env.events().publish(("lumenflow", "issuer_allowed"), issuer);
        Ok(())
    }

    /// Remove an issuer address from the approved-issuer list (admin only).
    pub fn remove_allowed_issuer(
        env: Env,
        admin: Address,
        issuer: Address,
    ) -> Result<(), PaymentError> {
        require_admin(&env, &admin)?;
        storage::set_issuer_allowed(&env, &issuer, false);
        env.events().publish(("lumenflow", "issuer_disallowed"), issuer);
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
    /// * `referral_id` - Optional address of the referring merchant. When provided,
    ///   the referrer's `referral_count` is incremented and a
    ///   `lumenflow/merchant_referred` event is emitted.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::MerchantAlreadyRegistered`] — the address is already registered.
    /// * [`PaymentError::InvalidInput`] — `name` is empty.
    /// * [`PaymentError::InvalidReferral`] — `referral_id` is the same as `merchant_address`
    ///   (self-referral) or does not belong to a registered merchant.
    pub fn register_merchant(
        env: Env,
        merchant_address: Address,
        name: String,
        description: String,
        contact_info: String,
        category: MerchantCategory,
        referral_id: Option<Address>,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        merchant_address.require_auth();
        require_non_empty_string(&name)?;
        validate_merchant_category(&category)?;

        if storage::get_merchant(&env, &merchant_address).is_some() {
            return Err(PaymentError::MerchantAlreadyRegistered);
        }

        // Validate referral_id before any writes so we never commit a partial state.
        if let Some(ref ref_addr) = referral_id {
            if *ref_addr == merchant_address {
                return Err(PaymentError::InvalidReferral);
            }
            if storage::get_merchant(&env, ref_addr).is_none() {
                return Err(PaymentError::InvalidReferral);
            }
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
            referral_count: 0,
        };

        storage::set_merchant(&env, &merchant);
        storage::add_to_merchant_list(&env, &merchant_address);

        let mut stats = storage::get_global_stats(&env);
        stats.active_merchants += 1;
        storage::set_global_stats(&env, &stats);

        // Update referrer's count and emit event (referral already validated above).
        if let Some(ref_addr) = referral_id {
            let mut referrer = storage::get_merchant(&env, &ref_addr)
                .ok_or(PaymentError::InvalidReferral)?;
            referrer.referral_count += 1;
            storage::set_merchant(&env, &referrer);
            env.events().publish(
                ("lumenflow", "merchant_referred"),
                (merchant_address.clone(), ref_addr),
            );
        }

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
        require_admin_rate_limited(&env, &admin)?;
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
        require_admin_rate_limited(&env, &admin)?;
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
        require_admin_rate_limited(&env, &admin)?;
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
        require_admin_rate_limited(&env, &admin)?;
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
    /// (`network_id || contract_address_xdr || nonce_be_u64 || order_id_xdr || amount_be_i128`).
    /// The `nonce` field must equal `current_merchant_nonce + 1`; on success the
    /// merchant's nonce counter is incremented, permanently invalidating any
    /// previously intercepted signature.
    ///
    /// # Arguments
    /// * `payer` - Address funding the payment. Must sign the call.
    /// * `order_id` - Unique, non-empty identifier for this payment.
    /// * `merchant_address` - Registered, active merchant receiving the funds.
    /// * `token_address` - Allowed token contract address.
    /// * `amount` - Positive token amount (in the token's smallest unit).
    /// * `memo` - Optional free-text note; maximum 256 characters.
    /// * `tags` - Optional list of string tags; each tag ≤ 32 characters, max 10 tags.
    /// * `nonce` - Must equal `get_merchant_nonce(merchant_address) + 1`. Prevents replay.
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
    /// * [`PaymentError::InvalidNonce`] — `nonce` does not equal current merchant nonce + 1.
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
        nonce: u64,
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

        // Replay protection: nonce must be exactly current_merchant_nonce + 1
        let expected_nonce = storage::get_merchant_nonce(&env, &merchant_address)
            .saturating_add(1);
        if nonce != expected_nonce {
            return Err(PaymentError::InvalidNonce);
        }

        // Reject disallowed tokens
        if !storage::is_token_allowed(&env, &token_address) {
            return Err(PaymentError::TokenNotAllowed);
        }

        // Build payload: network_id || contract_address || nonce || order_id || amount
        let mut payload = Bytes::new(&env);
        let network_id_bytes: Bytes = env.ledger().network_id().into();
        payload.append(&network_id_bytes);
        payload.append(&env.current_contract_address().to_xdr(&env));
        payload.append(&Bytes::from_slice(&env, &nonce.to_be_bytes()));
        payload.append(&order_id.clone().to_xdr(&env));
        payload.append(&Bytes::from_slice(&env, &amount.to_be_bytes()));
        verify_signature(&env, &merchant_public_key, &payload, &signature)?;

        // Advance merchant nonce before any external calls (checks-effects-interactions)
        storage::increment_merchant_nonce(&env, &merchant_address);

        // Rate-limit: reject if merchant has exceeded the window limit
        let window_start = storage::current_window_start(&env);
        let current_count = storage::get_rate_limit_counter(&env, &merchant_address, window_start);
        let rate_limit = storage::get_rate_limit_per_window(&env);
        if current_count >= rate_limit {
            return Err(PaymentError::RateLimitExceeded);
        }
        storage::increment_rate_limit_counter(&env, &merchant_address, window_start);

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
            ("lumenflow", "payment_processed", merchant_address.clone()),
            (order_id, payer, amount),
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
            ("lumenflow", "payment_processed", merchant_address.clone()),
            (order_id, payer, amount),
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

    /// Return the current nonce for `merchant_address`.
    ///
    /// The nonce is embedded in the signature payload to prevent signature replay
    /// across different order IDs. The expected nonce for the next payment is
    /// `get_merchant_nonce(...) + 1`. Starts at 0 for newly registered merchants.
    ///
    /// # Arguments
    /// * `merchant_address` - The merchant address whose nonce is queried.
    ///
    /// # Returns
    /// The current u64 nonce value.
    pub fn get_merchant_nonce(env: Env, merchant_address: Address) -> u64 {
        storage::get_merchant_nonce(&env, &merchant_address)
    }

    /// Pay multiple merchants in one transaction. Maximum 10 items. Atomic.
    ///
    /// All items are validated and signatures verified in a first pass before any
    /// token transfer occurs. Transfers are then **grouped by `(token_address,
    /// merchant_address)` pair**: when multiple items share the same token and
    /// merchant, their amounts are summed and only **one `token.transfer` call**
    /// is made for that pair, reducing the total number of cross-contract calls
    /// from N (one per item) to M (one per unique token+merchant combination).
    ///
    /// # Arguments
    /// * `payer` - Address funding all payments. Must sign the call.
    /// * `payments` - List of up to 10 [`BatchPaymentItem`] entries, each containing
    ///   `order_id`, `merchant_address`, `token_address`, `amount`, `memo`, `tags`,
    ///   `signature`, and `merchant_public_key`.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::BatchSizeExceeded`] — more than 10 items provided.
    /// * [`PaymentError::InvalidAmount`] — any item has a non-positive amount.
    /// * [`PaymentError::InvalidInput`] — any item has an empty `order_id` or invalid tags.
    /// * [`PaymentError::TokenNotAllowed`] — any item's token is not on the allow-list.
    /// * [`PaymentError::PaymentAlreadyExists`] — any item's `order_id` already exists
    ///   on-chain or appears more than once within this batch.
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

        // ── Phase 1: Validate ALL items first — fail fast before any state change ──
        //
        // We also track intra-batch duplicate order IDs with a linear scan (no_std
        // environment: no HashMap/BTreeMap available, only soroban_sdk::Vec).
        let mut seen_ids: Vec<String> = Vec::new(&env);
        for item in payments.iter() {
            require_positive(item.amount)?;
            require_valid_id(&item.order_id)?;
            validate_tags(&item.tags)?;

            // Intra-batch duplicate check (linear scan — max 10 iterations)
            for seen in seen_ids.iter() {
                if seen == item.order_id {
                    return Err(PaymentError::PaymentAlreadyExists);
                }
            }
            seen_ids.push_back(item.order_id.clone());

            // Whitelist check: each item's token_address must be in the allowed list.
            // If any item uses a disallowed token the entire batch is rejected atomically
            // (no partial payments are made). One storage read per item; callers can
            // reduce cost by grouping items that share the same token.
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

            // Rate-limit check per merchant
            let window_start = storage::current_window_start(&env);
            let current_count = storage::get_rate_limit_counter(&env, &item.merchant_address, window_start);
            let rate_limit = storage::get_rate_limit_per_window(&env);
            if current_count >= rate_limit {
                return Err(PaymentError::RateLimitExceeded);
            }
            storage::increment_rate_limit_counter(&env, &item.merchant_address, window_start);

            // Build payload: order_id bytes + amount bytes
            let mut payload = Bytes::new(&env);
            let network_id_bytes: Bytes = env.ledger().network_id().into();
            payload.append(&network_id_bytes);
            payload.append(&env.current_contract_address().to_xdr(&env));
            payload.append(&item.order_id.clone().to_xdr(&env));
            payload.append(&Bytes::from_slice(&env, &item.amount.to_be_bytes()));
            verify_signature(&env, &item.merchant_public_key, &payload, &item.signature)?;
        }

        // ── Phase 2: Group amounts by (token_address, merchant_address) ──
        //
        // We use a Vec of (token, merchant, total_amount) tuples and a linear scan
        // to accumulate sums.  With at most 10 items this is O(n²) in the worst
        // case but n ≤ 10, so it is effectively constant and avoids any std
        // collection type.
        //
        // Each entry is (token_address, merchant_address, grouped_total).
        let mut groups: Vec<(Address, Address, i128)> = Vec::new(&env);

        for item in payments.iter() {
            let mut found = false;
            // Rebuild a new vec accumulating updated entries — soroban_sdk::Vec
            // does not support in-place mutation of interior values.
            let mut updated_groups: Vec<(Address, Address, i128)> = Vec::new(&env);
            for (tok, merch, total) in groups.iter() {
                if tok == item.token_address && merch == item.merchant_address {
                    updated_groups.push_back((tok, merch, total + item.amount));
                    found = true;
                } else {
                    updated_groups.push_back((tok, merch, total));
                }
            }
            if !found {
                updated_groups.push_back((
                    item.token_address.clone(),
                    item.merchant_address.clone(),
                    item.amount,
                ));
            }
            groups = updated_groups;
        }

        // ── Phase 3: Execute one token.transfer per unique (token, merchant) group ──
        for (tok, merch, grouped_total) in groups.iter() {
            let token_client = token::Client::new(&env, &tok);
            token_client.transfer(&payer, &merch, &grouped_total);
        }

        // ── Phase 4: Store payment records and update stats for all items ──
        let now = env.ledger().timestamp();
        let mut global_stats = storage::get_global_stats(&env);

        for item in payments.iter() {
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
                tags: item.tags.clone(),
                platform_fee: 0,
            };

            storage::set_payment(&env, &payment);
            storage::add_merchant_payment_id(&env, &item.merchant_address, &item.order_id)?;
            storage::add_payer_payment_id(&env, &payer, &item.order_id)?;

            // Update merchant total_received
            if let Some(mut m) = storage::get_merchant(&env, &item.merchant_address) {
                m.total_received += item.amount;
                storage::set_merchant(&env, &m);
            }

            // Update per-merchant stats
            let mut merchant_stats = storage::get_merchant_stats(&env, &item.merchant_address);
            merchant_stats.total_payments += 1;
            merchant_stats.total_volume = merchant_stats.total_volume.saturating_add(item.amount);
            storage::set_merchant_stats(&env, &item.merchant_address, &merchant_stats);

            // Accumulate into a single global stats update (written once after the loop)
            global_stats.total_payments += 1;
            global_stats.total_volume = global_stats.total_volume.saturating_add(item.amount);
        }

        // Write the accumulated global stats once
        storage::set_global_stats(&env, &global_stats);

        // ── Phase 5: Emit per-item payment_processed events ──
        for item in payments.iter() {
            env.events().publish(
                ("lumenflow", "payment_processed", item.merchant_address.clone()),
                (
                    item.order_id,
                    payer.clone(),
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
        let original_amount = payment.amount;
        storage::set_payment(&env, &payment);
        env.events().publish(
            ("lumenflow", "payment_status_updated"),
            PaymentStatusUpdatedEvent {
                order_id,
                status: payment.status,
                refunded_amount: payment.refunded_amount,
                original_amount,
            },
        );
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
        require_admin_rate_limited(&env, &admin)?;
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
        require_admin_rate_limited(&env, &admin)?;
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
        require_admin_rate_limited(&env, &admin)?;

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

    /// Returns the current payment-ID index count for `address`, as either a
    /// merchant or a payer — whichever is higher, since each index independently
    /// enforces `storage::MAX_PAYMENT_IDS_PER_ACCOUNT`.
    pub fn get_account_payment_count(env: Env, address: Address) -> u32 {
        storage::get_merchant_payment_count(&env, &address)
            .max(storage::get_payer_payment_count(&env, &address))
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
    /// * [`PaymentError::RefundLimitExceeded`] — the per-order refund limit has been reached.
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

        let existing_refund_ids = storage::get_order_refund_ids(&env, &order_id);
        if existing_refund_ids.len() as usize >= MAX_REFUNDS_PER_PAYMENT {
            return Err(PaymentError::RefundLimitExceeded);
        }

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

        env.events().publish(
            ("lumenflow", "refund_initiated", payment.merchant_address.clone()),
            (refund_id.clone(), order_id.clone()),
        );
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

        env.events().publish(
            ("lumenflow", "refund_approved", payment.merchant_address.clone()),
            (refund_id.clone(), r.order_id.clone()),
        );
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

        env.events().publish(
            ("lumenflow", "refund_rejected", payment.merchant_address.clone()),
            (refund_id.clone(), r.order_id.clone()),
        );
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

        env.events().publish(
            ("lumenflow", "refund_executed", payment.merchant_address.clone()),
            (refund_id, r.order_id.clone()),
        );
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

    // ── Dispute resolution ────────────────────────────────────────────────────

    /// Raise a dispute against a rejected refund (payer only).
    ///
    /// Creates a [`DisputeRecord`] in `Open` state linked to the rejected refund.
    /// The dispute can be resolved by an admin via [`resolve_dispute`].
    ///
    /// # Arguments
    /// * `caller` - Must be the payer of the original payment. Must sign the call.
    /// * `dispute_id` - Unique, non-empty identifier for this dispute (max 64 chars).
    /// * `refund_id` - The refund that was rejected and is being disputed.
    /// * `reason` - Human-readable reason for the dispute; maximum 256 characters.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidInput`] — `dispute_id` empty/too long or `reason` > 256 chars.
    /// * [`PaymentError::DisputeAlreadyExists`] — a dispute with `dispute_id` already exists.
    /// * [`PaymentError::RefundNotFound`] — no refund exists with `refund_id`.
    /// * [`PaymentError::DisputeRefundNotRejected`] — the refund is not in `Rejected` state.
    /// * [`PaymentError::PaymentNotFound`] — the associated payment no longer exists.
    /// * [`PaymentError::Unauthorized`] — `caller` is not the payer of the original payment.
    pub fn raise_dispute(
        env: Env,
        caller: Address,
        dispute_id: String,
        refund_id: String,
        reason: String,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        caller.require_auth();
        require_valid_id(&dispute_id)?;

        if reason.len() > 256 {
            return Err(PaymentError::InvalidInput);
        }

        if storage::get_dispute(&env, &dispute_id).is_some() {
            return Err(PaymentError::DisputeAlreadyExists);
        }

        let refund = storage::get_refund(&env, &refund_id).ok_or(PaymentError::RefundNotFound)?;

        // Dispute can only be raised on a rejected refund
        if !matches!(refund.status, RefundStatus::Rejected) {
            return Err(PaymentError::DisputeRefundNotRejected);
        }

        let payment =
            storage::get_payment(&env, &refund.order_id).ok_or(PaymentError::PaymentNotFound)?;

        // Only the payer of the original payment can raise a dispute
        if caller != payment.payer {
            return Err(PaymentError::Unauthorized);
        }

        let now = env.ledger().timestamp();
        let dispute = types::DisputeRecord {
            dispute_id: dispute_id.clone(),
            refund_id: refund_id.clone(),
            order_id: refund.order_id.clone(),
            initiator: caller,
            reason,
            status: types::DisputeStatus::Open,
            resolution: None,
            created_at: now,
        };
        storage::set_dispute(&env, &dispute);

        env.events().publish(
            ("lumenflow", "dispute_raised"),
            (dispute_id, refund_id, refund.order_id),
        );
        Ok(())
    }

    /// Resolve a dispute (admin only).
    ///
    /// Marks the dispute resolved. If `force_refund` is `true`, immediately
    /// transfers the refund amount from the merchant to the payer, bypassing
    /// merchant approval.
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator. Must sign the call.
    /// * `dispute_id` - The dispute to resolve.
    /// * `resolution` - Admin's resolution notes (1–256 characters, required).
    /// * `force_refund` - If `true`, execute the refund immediately.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    /// * [`PaymentError::DisputeNotFound`] — no dispute exists with `dispute_id`.
    /// * [`PaymentError::DisputeAlreadyResolved`] — the dispute is already resolved.
    /// * [`PaymentError::RefundNotFound`] — the referenced refund no longer exists (force_refund only).
    /// * [`PaymentError::PaymentNotFound`] — the referenced payment no longer exists (force_refund only).
    pub fn resolve_dispute(
        env: Env,
        admin: Address,
        dispute_id: String,
        resolution: String,
        force_refund: bool,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        require_admin_rate_limited(&env, &admin)?;

        if resolution.len() == 0 || resolution.len() > 256 {
            return Err(PaymentError::InvalidInput);
        }

        let mut dispute =
            storage::get_dispute(&env, &dispute_id).ok_or(PaymentError::DisputeNotFound)?;

        if matches!(dispute.status, types::DisputeStatus::Resolved) {
            return Err(PaymentError::DisputeAlreadyResolved);
        }

        // Effects: update dispute state before any external calls
        dispute.status = types::DisputeStatus::Resolved;
        dispute.resolution = Some(resolution.clone());
        storage::set_dispute(&env, &dispute);

        if force_refund {
            let refund = storage::get_refund(&env, &dispute.refund_id)
                .ok_or(PaymentError::RefundNotFound)?;
            let mut payment = storage::get_payment(&env, &refund.order_id)
                .ok_or(PaymentError::PaymentNotFound)?;

            let refund_amount = refund.amount;

            // Update payment state before external call (checks-effects-interactions)
            payment.refunded_amount += refund_amount;
            payment.status = if payment.refunded_amount >= payment.amount {
                PaymentStatus::FullyRefunded
            } else {
                PaymentStatus::PartiallyRefunded
            };
            storage::set_payment(&env, &payment);

            // Transition refund to Completed
            let mut r = refund;
            r.status = RefundStatus::Completed;
            storage::set_refund(&env, &r);

            // Update global stats
            let mut stats = storage::get_global_stats(&env);
            stats.total_refunds += 1;
            stats.total_refund_volume = stats.total_refund_volume.saturating_add(refund_amount);
            storage::set_global_stats(&env, &stats);

            // Update merchant stats
            let mut merchant_stats = storage::get_merchant_stats(&env, &payment.merchant_address);
            merchant_stats.total_refunds += 1;
            merchant_stats.total_refund_volume =
                merchant_stats.total_refund_volume.saturating_add(refund_amount);
            storage::set_merchant_stats(&env, &payment.merchant_address, &merchant_stats);

            // Interaction: forced token transfer from merchant to payer
            let token_client = token::Client::new(&env, &payment.token);
            token_client.transfer(&payment.merchant_address, &payment.payer, &refund_amount);
        }

        env.events().publish(
            ("lumenflow", "dispute_resolved"),
            (dispute_id, resolution, force_refund),
        );
        Ok(())
    }

    /// Get a dispute record by ID.
    ///
    /// # Arguments
    /// * `dispute_id` - The dispute identifier to look up.
    ///
    /// # Returns
    /// The [`DisputeRecord`] on success.
    ///
    /// # Errors
    /// * [`PaymentError::DisputeNotFound`] — no dispute exists with `dispute_id`.
    pub fn get_dispute(
        env: Env,
        dispute_id: String,
    ) -> Result<types::DisputeRecord, PaymentError> {
        storage::get_dispute(&env, &dispute_id).ok_or(PaymentError::DisputeNotFound)
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

        env.events().publish(
            ("lumenflow", "multisig_initiated"),
            MultisigInitiatedEvent {
                payment_id,
                merchant: ms.merchant_address,
                token: ms.token,
                amount: ms.amount,
                required_signatures: ms.required_signatures,
            },
        );
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

        env.events().publish(
            ("lumenflow", "multisig_executed"),
            MultisigExecutedEvent {
                payment_id,
                payer,
                merchant: ms.merchant_address,
                token: ms.token,
                amount: ms.amount,
            },
        );
        Ok(())
    }

    // ── Versioning ────────────────────────────────────────────────────────────

    /// Admin: record the current binary version on-chain (call once after deploy/upgrade).
    pub fn set_contract_version(env: Env, admin: Address) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
        let version = String::from_str(&env, env!("CARGO_PKG_VERSION"));
        storage::set_stored_version(&env, &version);
        Ok(())
    }

    /// One-time storage migration from v1 verbose key names to v2 short codes.
    ///
    /// Call this function **once** immediately after upgrading to the version
    /// that introduces the shortened `DataKey` variant names (#566). It remaps
    /// all instance-storage singleton keys (e.g. `CleanupPeriod` → `CP`,
    /// `LargePaymentThreshold` → `LPT`) to their new compact representations.
    ///
    /// The migration is idempotent — calling it again after the keys have
    /// already been migrated is safe and has no effect.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — caller is not the admin.
    pub fn migrate_storage_keys(env: Env, admin: Address) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
        storage::migrate_storage_keys(&env);
        Ok(())
    }

    /// Admin guard: returns error if stored on-chain version does not match binary version.
    pub fn assert_version_matches(env: Env, admin: Address) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
        let current = String::from_str(&env, env!("CARGO_PKG_VERSION"));
        if let Some(stored) = storage::get_stored_version(&env) {
            if stored != current {
                return Err(PaymentError::VersionMismatch);
            }
        }
        Ok(())
    }

    /// Upgrade the contract WASM to a new hash (admin only).
    ///
    /// Replaces the deployed contract binary with the WASM identified by
    /// `new_wasm_hash`. The hash must have been uploaded to the network with
    /// `stellar contract upload` before this call. The function:
    ///   1. Verifies the caller is the stored admin.
    ///   2. Calls `env.deployer().update_current_contract_wasm(new_wasm_hash)`.
    ///   3. Emits a `lumenflow/contract_upgraded` event with the new WASM hash.
    ///
    /// After the upgrade, call `set_contract_version` to record the new version
    /// on-chain, then `assert_version_matches` to confirm the stored version
    /// aligns with the binary. A mismatch returns [`PaymentError::VersionMismatch`].
    ///
    /// # Arguments
    /// * `admin` - Must be the configured administrator address.
    /// * `new_wasm_hash` - 32-byte SHA-256 hash of the new WASM binary.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::Unauthorized`] — `admin` is not the configured administrator.
    pub fn upgrade(
        env: Env,
        admin: Address,
        new_wasm_hash: soroban_sdk::BytesN<32>,
    ) -> Result<(), PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
        env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
        env.events()
            .publish(("lumenflow", "contract_upgraded"), new_wasm_hash);
        Ok(())
    }

    // ── Upgrade / storage compatibility ───────────────────────────────────────

    /// Initialise (or upgrade) the on-chain storage schema version.
    ///
    /// Call this **once** immediately after deploying a new binary:
    /// 1. If the stored version equals `CURRENT_STORAGE_VERSION` this is a
    ///    no-op (safe to call repeatedly).
    /// 2. If the stored version is less than `CURRENT_STORAGE_VERSION` the
    ///    migration is accepted and the version is bumped.
    /// 3. If the stored version is *greater* than `CURRENT_STORAGE_VERSION` the
    ///    binary is too old for the data on-chain — the call is rejected with
    ///    `StorageVersionTooNew`.
    ///
    /// Admin only.
    pub fn migrate(env: Env, admin: Address) -> Result<u32, PaymentError> {
        require_admin(&env, &admin)?;

        let on_chain = storage::get_storage_version(&env);
        let current = storage::CURRENT_STORAGE_VERSION;

        if on_chain > current {
            // The stored data was written by a *newer* binary.  Refusing to run
            // prevents silent data corruption from field misalignment.
            return Err(PaymentError::StorageVersionTooNew);
        }

        // Accept the migration (including the initial 0 → 1 write-in).
        storage::set_storage_version(&env, current);

        env.events().publish(
            ("lumenflow", "storage_migrated"),
            (on_chain, current),
        );
        Ok(current)
    }

    /// Read-only check used by off-chain tooling or upgrade scripts to verify
    /// that the binary and the on-chain data are compatible before executing
    /// `migrate`.
    ///
    /// Returns `Ok(version)` when the stored version matches the compiled-in
    /// `CURRENT_STORAGE_VERSION`.  Returns an error otherwise.
    pub fn check_upgrade_compatibility(env: Env) -> Result<u32, PaymentError> {
        let on_chain = storage::get_storage_version(&env);
        let current = storage::CURRENT_STORAGE_VERSION;

        if on_chain > current {
            return Err(PaymentError::StorageVersionTooNew);
        }
        if on_chain < current {
            return Err(PaymentError::StorageMigrationRequired);
        }
        Ok(current)
    }

    // ── Internal helpers ──────────────────────────────────────────────────────

    /// List merchants with cursor-based pagination. Admin only.
    pub fn get_merchants(
        env: Env,
        admin: Address,
        cursor: Option<Address>,
        limit: u32,
    ) -> Result<MerchantPage, PaymentError> {
        require_admin_rate_limited(&env, &admin)?;
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
        require_bounded_string(&request_id, 1, 64)?;

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

        // Capture fields for event before pr fields are moved into PaymentOrder
        let event_merchant = pr.merchant.clone();
        let event_token = pr.token.clone();
        let event_amount = pr.amount;

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
        require_admin_rate_limited(&env, &admin)?;
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

    // ── Escrow ────────────────────────────────────────────────────────────────

    /// Lock funds in a time-locked escrow.
    ///
    /// Transfers `amount` tokens from `payer` into the contract's own address
    /// where they remain frozen until `unlock_at`. The payer may cancel before
    /// `unlock_at`; the merchant may release after it.
    ///
    /// # Arguments
    /// * `payer` - Address funding the escrow. Must sign the call.
    /// * `merchant` - Registered, active merchant that will receive funds on release.
    /// * `amount` - Positive token amount to lock.
    /// * `token` - Allowed token contract address.
    /// * `unlock_at` - Unix timestamp after which the escrow can be released.
    /// * `order_id` - Unique, non-empty identifier for this escrow.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::InvalidAmount`] — `amount` is not positive.
    /// * [`PaymentError::InvalidInput`] — `order_id` is empty or `unlock_at` is in the past.
    /// * [`PaymentError::TokenNotAllowed`] — `token` is not on the allow-list.
    /// * [`PaymentError::EscrowAlreadyExists`] — an escrow with `order_id` already exists.
    /// * [`PaymentError::MerchantNotFound`] — no merchant registered at `merchant`.
    /// * [`PaymentError::MerchantInactive`] — the merchant has been deactivated.
    pub fn create_escrow(
        env: Env,
        payer: Address,
        merchant: Address,
        amount: i128,
        token: Address,
        unlock_at: u64,
        order_id: String,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        payer.require_auth();
        require_positive(amount)?;
        require_valid_id(&order_id)?;

        let now = env.ledger().timestamp();
        if unlock_at <= now {
            return Err(PaymentError::InvalidInput);
        }

        if !storage::is_token_allowed(&env, &token) {
            return Err(PaymentError::TokenNotAllowed);
        }

        if storage::get_escrow(&env, &order_id).is_some() {
            return Err(PaymentError::EscrowAlreadyExists);
        }

        let m = storage::get_merchant(&env, &merchant).ok_or(PaymentError::MerchantNotFound)?;
        if !m.active {
            return Err(PaymentError::MerchantInactive);
        }

        // Lock funds: transfer from payer into this contract
        let token_client = token::Client::new(&env, &token);
        token_client.transfer(&payer, &env.current_contract_address(), &amount);

        let escrow = EscrowRecord {
            order_id: order_id.clone(),
            payer,
            merchant,
            token,
            amount,
            unlock_at,
            status: EscrowStatus::Locked,
            created_at: now,
        };
        storage::set_escrow(&env, &escrow);

        env.events()
            .publish(("lumenflow", "escrow_created"), (order_id, amount));
        Ok(())
    }

    /// Release escrowed funds to the merchant after the unlock time.
    ///
    /// Can be called by anyone once `unlock_at` has passed; funds go to the merchant.
    ///
    /// # Arguments
    /// * `order_id` - The escrow to release.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::EscrowNotFound`] — no escrow exists with `order_id`.
    /// * [`PaymentError::EscrowAlreadyFinalised`] — escrow is not in `Locked` state.
    /// * [`PaymentError::EscrowNotUnlocked`] — `unlock_at` timestamp has not yet passed.
    pub fn release_escrow(env: Env, order_id: String) -> Result<(), PaymentError> {
        require_not_paused(&env)?;

        let mut escrow =
            storage::get_escrow(&env, &order_id).ok_or(PaymentError::EscrowNotFound)?;

        if !matches!(escrow.status, EscrowStatus::Locked) {
            return Err(PaymentError::EscrowAlreadyFinalised);
        }

        let now = env.ledger().timestamp();
        if now < escrow.unlock_at {
            return Err(PaymentError::EscrowNotUnlocked);
        }

        // Effects before interaction
        escrow.status = EscrowStatus::Released;
        storage::set_escrow(&env, &escrow);

        // Transfer funds from contract to merchant
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.merchant,
            &escrow.amount,
        );

        env.events()
            .publish(("lumenflow", "escrow_released"), (order_id, escrow.amount));
        Ok(())
    }

    /// Cancel an escrow and return funds to the payer — only before the unlock time.
    ///
    /// Only the original payer may cancel. After `unlock_at` has passed the
    /// escrow can no longer be cancelled; call `release_escrow` instead.
    ///
    /// # Arguments
    /// * `payer` - Must be the payer who created the escrow. Must sign the call.
    /// * `order_id` - The escrow to cancel.
    ///
    /// # Returns
    /// `Ok(())` on success.
    ///
    /// # Errors
    /// * [`PaymentError::EscrowNotFound`] — no escrow exists with `order_id`.
    /// * [`PaymentError::EscrowAlreadyFinalised`] — escrow is not in `Locked` state.
    /// * [`PaymentError::EscrowUnauthorised`] — caller is not the escrow payer.
    /// * [`PaymentError::EscrowLockExpired`] — `unlock_at` has already passed.
    pub fn cancel_escrow_before_lock(
        env: Env,
        payer: Address,
        order_id: String,
    ) -> Result<(), PaymentError> {
        require_not_paused(&env)?;
        payer.require_auth();

        let mut escrow =
            storage::get_escrow(&env, &order_id).ok_or(PaymentError::EscrowNotFound)?;

        if !matches!(escrow.status, EscrowStatus::Locked) {
            return Err(PaymentError::EscrowAlreadyFinalised);
        }

        if escrow.payer != payer {
            return Err(PaymentError::EscrowUnauthorised);
        }

        let now = env.ledger().timestamp();
        if now >= escrow.unlock_at {
            return Err(PaymentError::EscrowLockExpired);
        }

        // Effects before interaction
        escrow.status = EscrowStatus::Cancelled;
        storage::set_escrow(&env, &escrow);

        // Return funds to payer
        let token_client = token::Client::new(&env, &escrow.token);
        token_client.transfer(
            &env.current_contract_address(),
            &escrow.payer,
            &escrow.amount,
        );

        env.events()
            .publish(("lumenflow", "escrow_cancelled"), (order_id, escrow.amount));
        Ok(())
    }

    /// Retrieve an escrow record by order ID.
    ///
    /// # Arguments
    /// * `order_id` - The unique escrow identifier.
    ///
    /// # Returns
    /// The [`EscrowRecord`] on success.
    ///
    /// # Errors
    /// * [`PaymentError::EscrowNotFound`] — no escrow exists with `order_id`.
    pub fn get_escrow(env: Env, order_id: String) -> Result<EscrowRecord, PaymentError> {
        storage::get_escrow(&env, &order_id).ok_or(PaymentError::EscrowNotFound)
    }
}
