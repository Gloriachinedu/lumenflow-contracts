# Merchant Onboarding Guide

This guide explains how to register a merchant with LumenFlow, including the recommended commit-reveal registration flow that protects against front-running attacks.

---

## Background: The Front-Running Problem

A naive single-transaction registration is vulnerable to front-running:

1. An attacker monitors the Stellar mempool.
2. The attacker sees a pending `register_merchant` transaction for address `G...`.
3. The attacker submits their own `register_merchant` for the same address with different (malicious) details.
4. If the attacker's transaction is included first, they control that merchant profile.

The commit-reveal pattern eliminates this attack by separating registration into two phases, with a cryptographic commitment that binds the registrant to their intended data before it is publicly visible.

---

## Recommended Flow: Commit-Reveal Registration

### Phase 1 — Commit

The merchant submits a hash of their registration data **without revealing the data itself**.

**Pre-image construction:**

```
pre_image = XDR(merchant_address) || XDR(name) || nonce_bytes
```

- `nonce_bytes` — 32 random bytes chosen by the client. Keep this secret until the reveal step.
- All fields are XDR-encoded using `soroban_sdk::xdr::ToXdr`.
- `commitment_hash = SHA-256(pre_image)` (32 bytes).

**Contract call:**

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY --network $NETWORK \
  -- commit_merchant_registration \
  --merchant_address $MERCHANT_ADDR \
  --commitment_hash "<hex-encoded-sha256-hash>"
```

**Important:** The commitment expires after **100 ledgers** (≈ 8 minutes with 5-second ledgers). You must call `reveal_merchant_registration` before expiry. After expiry the commitment is automatically invalidated and you must re-commit.

---

### Phase 2 — Reveal

After the commitment is stored on-chain (typically 1–2 ledger confirmations), the merchant reveals the original data:

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY --network $NETWORK \
  -- reveal_merchant_registration \
  --merchant_address $MERCHANT_ADDR \
  --name "My Store" \
  --description "Store description" \
  --contact_info "contact@store.com" \
  --category Retail \
  --nonce "<32-bytes-used-at-commit-time>"
```

The contract:
1. Loads the stored commitment for `merchant_address`.
2. Checks that fewer than 100 ledgers have passed since `commit_merchant_registration`.
3. Recomputes `SHA-256(XDR(merchant_address) || XDR(name) || nonce_bytes)`.
4. Verifies the hash matches the stored commitment.
5. Registers the merchant and emits `lumenflow/merchant_registered`.

---

## Client-Side Example (TypeScript / SDK)

```typescript
import { Keypair, hash } from "@stellar/stellar-sdk";
import { randomBytes } from "crypto";
import { LumenFlowClient } from "@lumenflow/sdk";

const merchantKeypair = Keypair.fromSecret(process.env.MERCHANT_SECRET!);
const merchantAddress = merchantKeypair.publicKey();
const name = "My Store";

// 1. Generate a random nonce
const nonce = randomBytes(32);

// 2. Build the pre-image: XDR(address) || XDR(name) || nonce
//    (see contracts/lumenflow/src/lib.rs::reveal_merchant_registration for
//    the exact XDR encoding used on-chain)
const preImage = Buffer.concat([
  xdrEncodeAddress(merchantAddress),   // XDR-encoded address
  xdrEncodeSorobanString(name),        // XDR-encoded soroban String
  nonce,
]);

// 3. Compute the commitment hash
const commitmentHash = hash(preImage);  // SHA-256, returns Buffer

// 4. Phase 1: commit
await client.commitMerchantRegistration({
  merchant_address: merchantAddress,
  commitment_hash: commitmentHash,
});

// Wait for ledger confirmation (1–2 ledgers), then:

// 5. Phase 2: reveal
await client.revealMerchantRegistration({
  merchant_address: merchantAddress,
  name,
  description: "Store description",
  contact_info: "contact@store.com",
  category: "Retail",
  nonce: nonce,
});
```

> **Note:** Helper functions `xdrEncodeAddress` and `xdrEncodeSorobanString` must produce byte-identical output to the `soroban_sdk::xdr::ToXdr` encoding used on-chain. The SDK provides utilities for this — see `sdk/src/signPaymentPayload.ts` for the pattern.

---

## Legacy Single-Step Registration

The original `register_merchant` function remains available for backwards compatibility but is **not recommended** for new integrations because it is susceptible to front-running.

```bash
stellar contract invoke --id $CONTRACT_ID --source-account $MERCHANT_KEY --network $NETWORK \
  -- register_merchant \
  --merchant_address $MERCHANT_ADDR \
  --name "My Store" \
  --description "Store description" \
  --contact_info "contact@store.com" \
  --category Retail
```

---

## Post-Registration Steps

1. **Verify registration:** Call `is_registered(merchant_address)` to confirm.
2. **Retrieve your profile:** Call `get_merchant(merchant_address)`.
3. **Request verification (optional):** Contact an admin to have your profile marked `verified`.

---

## Error Reference

| Error | Cause | Remediation |
|---|---|---|
| `CommitmentAlreadyExists` (72) | A pending commitment already exists | Reveal the existing commitment or wait for it to expire |
| `CommitmentNotFound` (73) | No pending commitment found | Call `commit_merchant_registration` first |
| `CommitmentHashMismatch` (74) | Revealed data does not match the committed hash | Ensure `name` and `nonce` are identical to what was used at commit time |
| `CommitmentExpired` (75) | More than 100 ledgers have passed since commit | Submit a new `commit_merchant_registration` |
| `MerchantAlreadyRegistered` (11) | Address is already registered | Use a different address or update the existing profile |

For the full error reference, see [docs/errors.md](./errors.md).
