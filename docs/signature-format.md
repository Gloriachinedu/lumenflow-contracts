# Signature Format

LumenFlow uses **Ed25519** signatures to authorise payment processing. The merchant signs a deterministic payload before the payer submits the transaction to the contract.

## Payload Layout

The payload is a UTF-8 string assembled from the following fields joined by colons (`:`):

```
<order_id>:<merchant_address>:<payer_address>:<token_address>:<amount>
```

| Field | Type | Description |
|---|---|---|
| `order_id` | string | Unique order identifier |
| `merchant_address` | string | Stellar `G…` address of the merchant |
| `payer_address` | string | Stellar `G…` address of the payer |
| `token_address` | string | Stellar `G…` address of the token contract |
| `amount` | string | Payment amount as a decimal integer string (stroops) |

### Example

```
ORDER_001:GABC...XYZ:GPAY...DEF:GTOK...789:1000
```

The raw UTF-8 bytes of this string are passed as `payload` to `env.crypto().ed25519_verify` inside the contract.

## Signing (off-chain)

```ts
import { buildSignaturePayload, signPayload } from "@lumenflow/sdk";

const payload = buildSignaturePayload({
  orderId: "ORDER_001",
  merchantAddress: "GABC...XYZ",
  payerAddress: "GPAY...DEF",
  tokenAddress: "GTOK...789",
  amount: 1000n,
});

// payload is a Uint8Array — pass it to your Ed25519 signer
const signature = await signPayload(merchantSecretKey, payload);
```

## Verification (on-chain)

The contract calls `env.crypto().ed25519_verify(&merchant_public_key, &payload, &signature)` inside `process_payment_with_signature`. A mismatch causes `InvalidSignature` (error code 23).

## Security Notes

- Replay attacks are prevented by the contract rejecting duplicate `order_id` values.
- The `amount` field is included in the payload to prevent amount-tampering.
- Signatures must be produced with the merchant's **Ed25519 private key**; the corresponding 32-byte public key is stored on-chain.
