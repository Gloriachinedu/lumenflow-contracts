# Signature Format

To process payments with a signature in LumenFlow, the merchant must sign a specific payload using their Ed25519 private key. This document describes the exact byte layout of that payload for SDK implementors.

## Payload Layout

The payload is the concatenation of the XDR-encoded `order_id` and the big-endian 16-byte representation of the `amount`.

| Field | Type | Description |
|-------|------|-------------|
| `order_id` | XDR String | The unique order identifier, encoded as a Stellar/Soroban XDR String. |
| `amount` | i128 (16 bytes) | The payment amount as a 128-bit signed integer in big-endian byte order. |

### 1. XDR Encoding of order_id

In the smart contract, `order_id.to_xdr()` is used. This produces the XDR representation of a Soroban `String` object. In the Stellar XDR definition, this corresponds to an `ScVal` of type `SCV_STRING`.

The byte layout for `order_id.to_xdr()` is:
- **ScVal Tag**: `0x0000000e` (4 bytes, representing `SCV_STRING` / 14)
- **Length**: 4 bytes, big-endian unsigned integer (number of bytes in the string).
- **Data**: The UTF-8 bytes of the string.
- **Padding**: 0 to 3 null bytes (`0x00`) to align the data to a 4-byte boundary.

### 2. Amount Encoding

The `amount` is a 128-bit signed integer. It must be encoded as exactly 16 bytes in big-endian order.

---

## JavaScript Implementation Example

Using the `@stellar/stellar-sdk` library:

```javascript
import { xdr } from '@stellar/stellar-sdk';

/**
 * Builds the payload that the merchant needs to sign.
 * 
 * @param {string} orderId - The unique order ID.
 * @param {bigint|string} amount - The payment amount.
 * @returns {Buffer} The concatenated payload.
 */
function buildSignaturePayload(orderId, amount) {
  // 1. Encode order_id as ScVal String XDR
  const orderIdXdr = xdr.ScVal.scvString(orderId).toXDR();

  // 2. Encode amount as 16-byte big-endian integer
  const amountBuf = Buffer.alloc(16);
  const bigAmount = BigInt(amount);
  // Write as two 64-bit parts
  amountBuf.writeBigInt64BE(bigAmount >> 64n, 0);
  amountBuf.writeBigInt64BE(bigAmount & 0xFFFFFFFFFFFFFFFFn, 8);

  return Buffer.concat([orderIdXdr, amountBuf]);
}
```

## Python Implementation Example

```python
import xdrbuf # or any XDR library
import struct

def build_signature_payload(order_id: str, amount: int):
    # 1. ScVal tag for SCV_STRING is 14
    tag = struct.pack(">I", 14)
    
    # 2. XDR String encoding (length + data + padding)
    order_bytes = order_id.encode('utf-8')
    length = struct.pack(">I", len(order_bytes))
    padding = b'\x00' * ((4 - (len(order_bytes) % 4)) % 4)
    
    # 3. Amount as 16-byte big-endian
    # Python's to_bytes handles 128-bit integers easily
    amount_bytes = amount.to_bytes(16, byteorder='big', signed=True)
    
    return tag + length + order_bytes + padding + amount_bytes
```

## Reference

- [Stellar XDR Definitions](https://github.com/stellar/stellar-core/blob/master/src/xdr/Stellar-ledger-entries.x#L571)
- [Soroban SDK String to_xdr](https://docs.rs/soroban-sdk/latest/soroban_sdk/struct.String.html#method.to_xdr)
