# Architecture Notes

## Replay Protection and Nonce Model

This contract implements a per-payer nonce counter to mitigate payment replay attacks.

- Each payer has an associated `PayerNonce` (u64) stored in contract persistent storage.
- New payments submitted via `process_payment_with_nonce` must supply the expected current nonce value.
- On successful processing the contract increments the payer's nonce by 1.
- If the supplied nonce does not match the stored value, the contract rejects the payment with `InvalidNonce`.

This design is chosen because Soroban does not provide a universal per-account sequence number at the contract entrypoint level; storing an on-chain per-payer counter provides deterministic replay protection tied to the payer's address.

Tests: see `contracts/lumenflow/src/test.rs` for an integration test that verifies nonce increment and replay rejection.
