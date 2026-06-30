use soroban_sdk::{Address, BytesN, Env, String};

use crate::error::PaymentError;
use crate::storage;

pub const MAX_PAGE_LIMIT: u32 = 100;
pub const REFUND_WINDOW_SECS: u64 = 30 * 24 * 3600; // 30 days

/// Require that the contract is not paused.
pub fn require_not_paused(env: &Env) -> Result<(), PaymentError> {
    if storage::is_paused(env) {
        Err(PaymentError::ContractPaused)
    } else {
        Ok(())
    }
}

/// Require that `caller` is the stored admin.
pub fn require_admin(env: &Env, caller: &Address) -> Result<(), PaymentError> {
    caller.require_auth();
    match storage::get_admin(env) {
        Some(admin) if admin == *caller => Ok(()),
        _ => Err(PaymentError::Unauthorized),
    }
}

/// Require that `caller` is either the stored admin or `allowed`.
pub fn require_admin_or(env: &Env, caller: &Address, allowed: &Address) -> Result<(), PaymentError> {
    caller.require_auth();
    let is_admin = storage::get_admin(env).map_or(false, |a| a == *caller);
    if is_admin || caller == allowed {
        Ok(())
    } else {
        Err(PaymentError::Unauthorized)
    }
}

/// Validate that `amount` is strictly positive.
pub fn require_positive(amount: i128) -> Result<(), PaymentError> {
    if amount > 0 {
        Ok(())
    } else {
        Err(PaymentError::InvalidAmount)
    }
}

/// Validate that `limit` does not exceed the page cap.
pub fn require_valid_limit(limit: u32) -> Result<(), PaymentError> {
    if limit == 0 || limit > MAX_PAGE_LIMIT {
        Err(PaymentError::PaginationLimitExceeded)
    } else {
        Ok(())
    }
}

/// Verify an ed25519 signature over `payload` using `public_key`.
/// In production Soroban the host provides `env.crypto().ed25519_verify`.
pub fn verify_signature(
    env: &Env,
    public_key: &soroban_sdk::Bytes,
    payload: &soroban_sdk::Bytes,
    signature: &soroban_sdk::Bytes,
) -> Result<(), PaymentError> {
    // Convert Bytes to BytesN with expected sizes
    let pub_key_vec = public_key.to_alloc_vec();
    let pub_key_array: [u8; 32] = pub_key_vec.try_into()
        .map_err(|_| PaymentError::InvalidSignature)?;
    let pub_key: BytesN<32> = BytesN::from_array(env, &pub_key_array);
    
    let sig_vec = signature.to_alloc_vec();
    let sig_array: [u8; 64] = sig_vec.try_into()
        .map_err(|_| PaymentError::InvalidSignature)?;
    let sig: BytesN<64> = BytesN::from_array(env, &sig_array);
    
    env.crypto()
        .ed25519_verify(&pub_key, payload, &sig);
    Ok(())
}

/// Validate a non-empty string field.
pub fn require_non_empty_string(s: &String) -> Result<(), PaymentError> {
    if s.len() == 0 {
        Err(PaymentError::InvalidInput)
    } else {
        Ok(())
    }
}
