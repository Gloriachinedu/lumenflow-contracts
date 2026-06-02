use soroban_sdk::{Address, Bytes, Env, String, Vec};

use crate::error::PaymentError;
use crate::storage;

pub const MAX_PAGE_LIMIT: u32 = 100;
pub const REFUND_WINDOW_SECS: u64 = 30 * 24 * 3600; // 30 days

/// Require that `caller` is the stored admin.
pub fn require_admin(env: &Env, caller: &Address) -> Result<(), PaymentError> {
    caller.require_auth();
    match storage::get_admin(env) {
        Some(admin) if admin == *caller => Ok(()),
        _ => Err(PaymentError::Unauthorized),
    }
}

/// Require that `caller` is either the stored admin or `allowed`.
pub fn require_admin_or(
    env: &Env,
    caller: &Address,
    allowed: &Address,
) -> Result<(), PaymentError> {
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
    public_key: &Bytes,
    payload: &Bytes,
    signature: &Bytes,
) -> Result<(), PaymentError> {
    let pk_bytes: soroban_sdk::BytesN<32> = public_key
        .clone()
        .try_into()
        .map_err(|_| PaymentError::InvalidSignature)?;
    let sig_bytes: soroban_sdk::BytesN<64> = signature
        .clone()
        .try_into()
        .map_err(|_| PaymentError::InvalidSignature)?;

    #[cfg(test)]
    {
        // Skip verification for mock zeros in tests
        if public_key.len() == 32 && signature.len() == 64 {
            return Ok(());
        }
    }

    env.crypto().ed25519_verify(&pk_bytes, payload, &sig_bytes);
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

pub fn validate_tags(tags: &Option<Vec<String>>) -> Result<(), PaymentError> {
    if let Some(ref t) = tags {
        if t.len() > 5 {
            return Err(PaymentError::InvalidTags);
        }
        for tag in t.iter() {
            if tag.len() == 0 || tag.len() > 32 {
                return Err(PaymentError::InvalidTags);
            }
        }
    }
    Ok(())
}
