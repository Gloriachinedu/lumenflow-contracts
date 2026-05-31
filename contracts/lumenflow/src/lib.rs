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
    require_valid_id, require_valid_limit, validate_memo_length, validate_tags, verify_signature, REFUND_WINDOW_SECS,
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

    /// One-time admin initialisation.
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

        env.events()
            .publish(("lumenflow", "merchant_deactivated"), merchant_address);
        Ok(())
    }

    /// Verify a merchant (admin only).
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
    pub fn get_merchant(env: Env, merchant_address: Address) -> Result<Merchant, PaymentError> {
        storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)
    }

    /// Check if a merchant address is already registered.
    pub fn is_registered(env: Env, merchant_address: Address) -> bool {
        storage::get_merchant(&env, &merchant_address).is_some()
    }


    // ── Payment processing ────────────────────────────────────────────────────

    /// Process a payment with an ed25519 signature from the merchant's key.
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
        require_valid_id(&order_id)?;
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
        require_valid_id(&order_id)?;
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
        require_valid_id(&refund_id)?;
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
    pub fn get_refund(env: Env, refund_id: String) -> Result<RefundRecord, PaymentError> {
        storage::get_refund(&env, &refund_id).ok_or(PaymentError::RefundNotFound)
    }

    /// Payer disputes a rejected refund, providing evidence.
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
        require_valid_id(&payment_id)?;

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
            cancelled: false,
            initiator: initiator.clone(),
            created_at: env.ledger().timestamp(),
        };
        storage::set_multisig(&env, &ms);

        env.events()
            .publish(("lumenflow", "multisig_initiated"), payment_id);
        Ok(())
    }

    /// Add a signature to a multisig payment.
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

        if ms.cancelled {
            return Err(PaymentError::MultisigAlreadyCancelled);
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

    /// Cancel a pending multisig payment. Only the initiator or admin can cancel.
    pub fn cancel_multisig_payment(
        env: Env,
        caller: Address,
        payment_id: String,
    ) -> Result<(), PaymentError> {
        caller.require_auth();
        let mut ms = storage::get_multisig(&env, &payment_id)
            .ok_or(PaymentError::MultisigNotFound)?;

        if ms.executed {
            return Err(PaymentError::MultisigAlreadyExecuted);
        }

        if ms.cancelled {
            return Err(PaymentError::MultisigAlreadyCancelled);
        }

        // Only initiator or admin can cancel
        let is_admin = storage::get_admin(&env).map_or(false, |a| a == caller);
        if !is_admin && caller != ms.initiator {
            return Err(PaymentError::Unauthorized);
        }

        ms.cancelled = true;
        storage::set_multisig(&env, &ms);

        env.events()
            .publish(("lumenflow", "multisig_cancelled"), payment_id);
        Ok(())
    }

    // ── Subscriptions ─────────────────────────────────────────────────────────

    /// Create a recurring payment plan. Merchant only.
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
