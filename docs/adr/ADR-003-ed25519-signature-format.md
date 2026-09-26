# ADR-003 — Ed25519 Off-Chain Signature Verification for Payment Authorisation

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-01-22 |
| **Deciders** | @Gloriachinedu |
| **Tags** | auth / security / signatures |

---

## Context

Payment processing in LumenFlow requires the merchant to authorise that a specific payer may pay a specific amount for a specific order. Without merchant authorisation, any party could invoke `process_payment_with_signature` and route funds to any merchant.

Soroban's native auth system (`require_auth`) requires the authorising party to be the **transaction signer** at the Stellar account layer. For payment flows, this creates a UX problem: the merchant would need to co-sign every payment transaction in real time, which is impractical for e-commerce integrations where payments are initiated by payers autonomously.

We needed a mechanism where the merchant can pre-authorise a payment off-chain (e.g. when the customer checks out on their website) and the payer can submit the payment later without the merchant needing to be online at submission time.

Three approaches were evaluated:

1. **Soroban `require_auth`** on the merchant address for every payment.
2. **Ed25519 off-chain signature** over a deterministic payload, verified inside the contract.
3. **Time-limited payment request** stored on-chain (already implemented as `PaymentRequest`/temporary storage).

---

## Decision

We will use **Ed25519 off-chain signatures** to authorise individual payments.

The merchant signs a canonical payload off-chain:

```
SHA-256( order_id || payer_address || merchant_address || token_address || amount || memo )
```

The contract verifies the signature using `env.crypto().ed25519_verify(public_key, message, signature)`.

The merchant's ed25519 public key is passed as a parameter (`merchant_public_key: Bytes`) and cross-checked against the registered merchant profile to prevent substitution attacks.

See [docs/signature-format.md](../signature-format.md) for the exact byte layout and SDK helpers.

---

## Consequences

### Positive
- Merchant does not need to be online at payment submission time.
- Standard Ed25519 signatures are well-understood, widely supported in SDKs (Node.js, Python, Rust).
- The Soroban crypto host function is highly efficient — no custom crypto code in the contract.
- Prevents replay attacks: the `order_id` is stored after first use and rejected on duplicate submission.

### Negative / Trade-offs
- Merchants must manage an Ed25519 signing key pair separate from their Stellar account key.
- If the merchant's private key is compromised, an attacker can authorise fraudulent payments.
- The public key is passed per-invocation, not stored as the merchant's canonical key — a merchant must consistently use the same key or rotate carefully.

### Neutral
- The signature payload format is versioned implicitly by the field ordering; any change to the canonical payload is a breaking change requiring a contract upgrade.

---

## Alternatives Considered

| Alternative | Reason not chosen |
|-------------|------------------|
| `require_auth` on merchant for every payment | Requires merchant to co-sign in real time; not suitable for async e-commerce flows |
| Payment request (temporary storage) | Solves the async problem but requires an extra on-chain transaction to create the request; adds latency and cost |
| Secp256k1 signatures | Ed25519 is natively supported by Soroban; secp256k1 would require a custom implementation |

---

## References

- `contracts/lumenflow/src/helper.rs` — `verify_payment_signature` function
- `contracts/lumenflow/src/lib.rs` — `process_payment_with_signature`
- [docs/signature-format.md](../signature-format.md) — Canonical payload byte layout and SDK examples
- [Soroban crypto host functions](https://docs.rs/soroban-sdk/latest/soroban_sdk/crypto/struct.Crypto.html)
