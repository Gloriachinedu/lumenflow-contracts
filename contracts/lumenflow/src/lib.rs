#![no_std]

mod error;
mod helper;
mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{
    contract, contractimpl, token, Address, Bytes, Env, String, Vec,
};

use error::PaymentError;
use helper::{
    require_admin, require_admin_or, require_non_empty_string, require_positive,
    require_valid_limit, verify_signature, REFUND_WINDOW_SECS,
};
use types::{
    GlobalStats, MerchantCategory, MultisigPayment, PaymentFilter, PaymentOrder, PaymentPage,
    PaymentStatus, RefundRecord, RefundStatus, SortField, SortOrder, StatusFilter,
    Merchant,
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
        Ok(())
    }

    /// Mark a merchant as verified (admin only).
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
        Ok(())
    }

    /// Revoke merchant verification (admin only).
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
        Ok(())
    }

    /// Get merchant info.
    pub fn get_merchant(env: Env, merchant_address: Address) -> Result<Merchant, PaymentError> {
        storage::get_merchant(&env, &merchant_address).ok_or(PaymentError::MerchantNotFound)
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
        signature: Bytes,
        merchant_public_key: Bytes,
    ) -> Result<(), PaymentError> {
        payer.require_auth();
        require_positive(amount)?;
        require_non_empty_string(&order_id)?;

        if storage::get_payment(&env, &order_id).is_some() {
            return Err(PaymentError::PaymentAlreadyExists);
        }

        let merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        if !merchant.active {
            return Err(PaymentError::MerchantInactive);
        }

        // Build payload: order_id bytes + amount bytes
        let mut payload = Bytes::new(&env);
        payload.append(&order_id.to_xdr(&env));
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

        env.events().publish(
            ("lumenflow", "payment_processed"),
            (order_id, payer, merchant_address, amount),
        );
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
        if storage::get_payment(&env, &order_id).is_none() {
            return Err(PaymentError::PaymentNotFound);
        }
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
        require_non_empty_string(&refund_id)?;

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
        stats.total_refund_volume += r.amount;
        storage::set_global_stats(&env, &stats);

        env.events()
            .publish(("lumenflow", "refund_executed"), refund_id);
        Ok(())
    }

    /// Get refund status.
    pub fn get_refund(env: Env, refund_id: String) -> Result<RefundRecord, PaymentError> {
        storage::get_refund(&env, &refund_id).ok_or(PaymentError::RefundNotFound)
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
        require_non_empty_string(&payment_id)?;

        if storage::get_multisig(&env, &payment_id).is_some() {
            return Err(PaymentError::PaymentAlreadyExists);
        }

        let merchant = storage::get_merchant(&env, &merchant_address)
            .ok_or(PaymentError::MerchantNotFound)?;
        if !merchant.active {
            return Err(PaymentError::MerchantInactive);
        }

        let ms = MultisigPayment {
            payment_id: payment_id.clone(),
            merchant_address,
            token: token_address,
            amount,
            required_signatures,
            signers,
            signatures: Vec::new(&env),
            executed: false,
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

        // Prevent double-signing (simple check: signature count vs signer index)
        if ms.signatures.len() >= ms.signers.len() {
            return Err(PaymentError::MultisigAlreadySigned);
        }

        ms.signatures.push_back(signature);
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

        if ms.signatures.len() < ms.required_signatures {
            return Err(PaymentError::InsufficientSignatures);
        }

        let token_client = token::Client::new(&env, &ms.token);
        token_client.transfer(&payer, &ms.merchant_address, &ms.amount);

        ms.executed = true;
        storage::set_multisig(&env, &ms);

        let mut stats = storage::get_global_stats(&env);
        stats.total_payments += 1;
        stats.total_volume += ms.amount;
        storage::set_global_stats(&env, &stats);

        env.events()
            .publish(("lumenflow", "multisig_executed"), payment_id);
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
}
