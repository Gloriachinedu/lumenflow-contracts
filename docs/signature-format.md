# LumenFlow Signature Payload Format

This document specifies the canonical encoding used for the ed25519 signature
payload in LumenFlow payment authorisation.  All integrators (contract, SDK,
and off-chain tooling) **must** use this format exactly.

---

## Why Length-Prefixed Canonicalisation?

The naive approach of concatenating field bytes directly is **vulnerable to
malleability attacks**.  Consider:

| order_id | amount raw bytes | Naive concat |
|----------|-----------------|--------------|
| `"AB"`   | `\x41\x42…`     | `AB4142…`    |
| `"ABAB"` | `\x42…`         | `ABAB42…` ← different |

An adversary could craft an `(order_id, amount)` pair whose raw bytes happen to
collide with a legitimately signed pair by shifting the field boundary.
Length-prefixing each field closes this attack surface by making the boundary
unambiguous.

---

## Canonical Format

Each field is serialised as:

```
[ 4-byte big-endian uint32 : byte length of field ]
[ N bytes : field data ]
```

The full payload for `process_payment_with_signature` is:

```
canonical_payload =
    u32_be(len(XDR(order_id))) || XDR(order_id)
 || u32_be(len(BE16(amount)))  || BE16(amount)
```

Where:
- `XDR(order_id)` — the Soroban `String` serialised to XDR bytes via `to_xdr()`.
- `BE16(amount)` — the `i128` amount serialised as 16 big-endian bytes.
- `u32_be(n)` — `n` encoded as a 4-byte big-endian unsigned integer.

The `amount` field is always exactly 16 bytes, so its length prefix is always
`\x00\x00\x00\x10`.

---

## Rust Implementation

The canonical payload is built by `build_canonical_payload` in
`contracts/lumenflow/src/helper.rs`:

```rust
pub fn build_canonical_payload(env: &Env, order_id: &String, amount: i128) -> Bytes {
    let mut payload = Bytes::new(env);
    let order_id_bytes = order_id.clone().to_xdr(env);
    let amount_bytes = Bytes::from_slice(env, &amount.to_be_bytes());
    append_length_prefixed(env, &mut payload, &order_id_bytes);
    append_length_prefixed(env, &mut payload, &amount_bytes);
    payload
}
```

---

## TypeScript / SDK Implementation

In the SDK (`sdk/src/signPaymentPayload.ts`):

```typescript
/**
 * Builds the canonical length-prefixed payload for a LumenFlow payment.
 *
 * Format per field:
 *   [ 4-byte BE uint32 length ][ field bytes ]
 *
 * Fields (in order):
 *   1. XDR-encoded order_id string
 *   2. 16-byte big-endian i128 amount
 */
export function buildCanonicalPayload(orderIdXdr: Uint8Array, amount: bigint): Uint8Array {
    const amountBytes = bigintToBeBytes16(amount);
    return concatLengthPrefixed(orderIdXdr, amountBytes);
}
```

See `sdk/src/signPaymentPayload.ts` for the full implementation including
`concatLengthPrefixed` and `bigintToBeBytes16`.

---

## Test Vectors

All hex values are lowercase without `0x` prefix.

### Vector 1 — Simple order

| Field | Value |
|-------|-------|
| `order_id` | `"ORD1"` (ASCII) |
| `amount` | `1000` |

XDR encoding of the Soroban `String "ORD1"`:
- XDR `ScVal::String` → type discriminant (4 bytes) + length (4 bytes) + data + padding
- Raw bytes (hex): `00000006 00000004 4f524431 00000000`
  (type=6 String, len=4, `O`=0x4f `R`=0x52 `D`=0x44 `1`=0x31, 0-padded to 4-byte boundary)

Amount `1000` as 16-byte big-endian i128:
```
00000000 00000000 00000000 000003e8
```

Canonical payload (hex):
```
[length of XDR(order_id) = 16 bytes → 00000010]
00000010
00000006 00000004 4f524431 00000000
[length of amount bytes = 16 → 00000010]
00000010
00000000 00000000 00000000 000003e8
```

Full hex string:
```
00000010 00000006 00000004 4f524431 00000000
00000010 00000000 00000000 00000000 000003e8
```

### Vector 2 — i128::MAX boundary

| Field | Value |
|-------|-------|
| `order_id` | `"MAX"` |
| `amount` | `170141183460469231731687303715884105727` (i128::MAX) |

Amount as 16-byte big-endian:
```
7fffffff ffffffff ffffffff ffffffff
```

Canonical payload ends with:
```
00000010 7fffffff ffffffff ffffffff ffffffff
```

### Vector 3 — Malleability attempt rejected

Payload for `("ORDER_A", 100)` and `("ORDER", 100)` produce **different** byte
sequences despite having the same trailing bytes, because the length prefixes
encode different order_id lengths.

---

## Cross-Verification Checklist

| Test | Location | Status |
|------|----------|--------|
| `test_canonical_payload_distinct_from_naive_concatenation` | `src/test.rs` | ✅ |
| `test_canonical_payload_swapped_fields_produces_different_bytes` | `src/test.rs` | ✅ |
| `test_canonical_payload_test_vector_known_values` | `src/test.rs` | ✅ |
| `test_swapped_field_payload_rejected_by_signature_check` | `src/test.rs` | ✅ |
| SDK `buildCanonicalPayload` unit tests | `sdk/src/signPaymentPayload.test.ts` | ✅ |

---

## Migration Notes

If you have existing signed payloads produced with the **old** naive format
(order_id XDR || amount BE, no length prefix), those signatures will no longer
verify against the new canonical format.  Re-sign all pending authorisation
payloads using the updated SDK before upgrading the on-chain contract.
