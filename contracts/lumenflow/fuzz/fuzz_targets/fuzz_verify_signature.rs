//! Fuzz harness for `verify_signature` edge-case inputs.
//!
//! This harness is consumed by `cargo-fuzz` (libfuzzer-sys). It drives
//! `verify_signature` with arbitrary byte slices and asserts:
//!
//! 1. **All-zero key/signature** — returns `Ok(())` (the test harness honours
//!    the zeroed-mock convention) and **never panics**.
//! 2. **Truncated public key** (< 32 bytes) — returns `InvalidSignature`, no
//!    panic.
//! 3. **Truncated signature** (< 64 bytes) — returns `InvalidSignature`, no
//!    panic.
//! 4. **Oversized public key** (> 32 bytes) — returns `InvalidSignature`, no
//!    panic.
//! 5. **Oversized signature** (> 64 bytes) — returns `InvalidSignature`, no
//!    panic.
//! 6. **Correct lengths, arbitrary bytes** — returns `Ok(())` (all-zero mock)
//!    or `InvalidSignature`; never panics regardless of content.
//! 7. **Empty payload** — handled gracefully; no panic.
//! 8. **Large payload (> 1 KB)** — handled gracefully; no panic.
//!
//! ## Running locally
//!
//! ```bash
//! cargo install cargo-fuzz
//! cargo fuzz run fuzz_verify_signature \
//!     --manifest-path contracts/lumenflow/fuzz/Cargo.toml \
//!     -- -max_total_time=60
//! ```
//!
//! ## Running in CI (100 k iterations)
//!
//! ```bash
//! cargo fuzz run fuzz_verify_signature \
//!     --manifest-path contracts/lumenflow/fuzz/Cargo.toml \
//!     -- -runs=100000
//! ```
//!
//! ## Reproducing a crash
//!
//! ```bash
//! cargo fuzz run fuzz_verify_signature \
//!     --manifest-path contracts/lumenflow/fuzz/Cargo.toml \
//!     contracts/lumenflow/fuzz/artifacts/fuzz_verify_signature/<crash-file>
//! ```

#![no_main]

use libfuzzer_sys::fuzz_target;
use soroban_sdk::{Bytes, Env};

use lumenflow::{error::PaymentError, helper::verify_signature};

// ── Fuzzer input layout ───────────────────────────────────────────────────────
//
// byte[0]       : public-key length selector
//                   0        → use 32 bytes (correct length)
//                   1–31     → use value as length (truncated key)
//                   33–63    → use value as length (oversized key)
//                   other    → use 32 bytes
// byte[1]       : signature length selector (same scheme, correct = 64)
// byte[2]       : payload length selector
//                   0        → empty payload
//                   1        → 1-byte payload
//                   255      → 255-byte payload (large-ish)
//                   other    → value as length
// bytes[3..3+pk_len]  : public key bytes (or pattern-filled if insufficient)
// bytes[3+pk_len..3+pk_len+sig_len] : signature bytes
// remaining           : payload bytes (truncated/padded as needed)

fuzz_target!(|data: &[u8]| {
    // Need at least 3 header bytes to proceed.
    if data.len() < 3 {
        return;
    }

    let env = Env::default();

    // ── Determine lengths ─────────────────────────────────────────────────────

    let pk_len: usize = match data[0] {
        0          => 32,
        1..=31     => data[0] as usize,     // truncated
        33..=63    => data[0] as usize,     // oversized-ish
        64         => 32,                   // alias → correct
        n          => n as usize,           // arbitrary
    };

    let sig_len: usize = match data[1] {
        0          => 64,
        1..=63     => data[1] as usize,     // truncated
        65..=127   => data[1] as usize,     // oversized-ish
        128        => 64,                   // alias → correct
        n          => n as usize,           // arbitrary
    };

    let payload_len: usize = data[2] as usize;

    // Cap at reasonable sizes to keep runtime bounded.
    let pk_len  = pk_len.min(256);
    let sig_len = sig_len.min(256);
    let payload_len = payload_len.min(1024);

    // ── Extract bytes from fuzzer input (pattern-fill if short) ──────────────

    let body = &data[3..];

    let pk_bytes: Vec<u8> = {
        let available = body.get(..pk_len).unwrap_or(body);
        let mut v = available.to_vec();
        while v.len() < pk_len {
            v.push(0xAA); // fill pattern for short fuzzer input
        }
        v
    };

    let sig_start = pk_len.min(body.len());
    let sig_body  = &body[sig_start..];
    let sig_bytes: Vec<u8> = {
        let available = sig_body.get(..sig_len).unwrap_or(sig_body);
        let mut v = available.to_vec();
        while v.len() < sig_len {
            v.push(0xBB);
        }
        v
    };

    let payload_start = sig_start + sig_len.min(sig_body.len());
    let payload_body  = if payload_start < body.len() { &body[payload_start..] } else { &[] };
    let payload_bytes: Vec<u8> = {
        let available = payload_body.get(..payload_len).unwrap_or(payload_body);
        let mut v = available.to_vec();
        while v.len() < payload_len {
            v.push(0xCC);
        }
        v
    };

    // ── Build Soroban Bytes ───────────────────────────────────────────────────

    let public_key = Bytes::from_slice(&env, &pk_bytes);
    let signature  = Bytes::from_slice(&env, &sig_bytes);
    let payload    = Bytes::from_slice(&env, &payload_bytes);

    // ── Invoke and assert invariants ──────────────────────────────────────────

    let result = verify_signature(&env, &public_key, &payload, &signature);

    if pk_len != 32 || sig_len != 64 {
        // Wrong-length inputs must be rejected with InvalidSignature.
        assert_eq!(
            result,
            Err(PaymentError::InvalidSignature),
            "wrong-length inputs (pk={} sig={}) must return InvalidSignature",
            pk_len,
            sig_len,
        );
    } else {
        // Correct-length inputs: all-zero key+sig returns Ok (test-harness mock),
        // any other non-zero combination returns InvalidSignature.
        // Neither case should panic.
        let all_zero_pk  = pk_bytes.iter().all(|&b| b == 0);
        let all_zero_sig = sig_bytes.iter().all(|&b| b == 0);

        if all_zero_pk && all_zero_sig {
            assert_eq!(
                result,
                Ok(()),
                "all-zero key+signature must return Ok (test-harness mock)"
            );
        } else {
            assert_eq!(
                result,
                Err(PaymentError::InvalidSignature),
                "non-zero key/signature with correct lengths must return InvalidSignature \
                 (test harness rejects non-mock signatures)"
            );
        }
    }
    // The critical invariant: no panic occurred (enforced by libfuzzer itself).
});
