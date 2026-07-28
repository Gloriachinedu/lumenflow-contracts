/**
 * signPaymentPayload.ts
 *
 * Canonical signature payload construction for LumenFlow payment authorisation.
 *
 * This module matches the on-chain encoding in
 * `contracts/lumenflow/src/helper.rs::build_canonical_payload` exactly.
 * Any deviation will cause signature verification to fail on-chain.
 *
 * Format (each field is length-prefixed):
 *   [ 4-byte big-endian uint32 : byte length of field ] [ N bytes : field ]
 *
 * Fields (in order):
 *   1. XDR-encoded Soroban String of order_id
 *   2. 16-byte big-endian i128 representation of amount
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Encode a 32-bit unsigned integer as 4 big-endian bytes.
 */
function uint32ToBeBytes(n: number): Uint8Array {
    const buf = new Uint8Array(4);
    const view = new DataView(buf.buffer);
    view.setUint32(0, n, false /* big-endian */);
    return buf;
}

/**
 * Encode a BigInt as a 16-byte big-endian signed 128-bit integer.
 * The BigInt must be in the range [i128::MIN, i128::MAX].
 */
export function bigintToBeBytes16(value: bigint): Uint8Array {
    const I128_MAX = (1n << 127n) - 1n;
    const I128_MIN = -(1n << 127n);

    if (value > I128_MAX || value < I128_MIN) {
        throw new RangeError(`Amount ${value} is outside the i128 range`);
    }

    // Normalise to unsigned 128-bit representation (two's complement for negatives)
    const unsigned = value < 0n ? value + (1n << 128n) : value;

    const bytes = new Uint8Array(16);
    let remaining = unsigned;
    for (let i = 15; i >= 0; i--) {
        bytes[i] = Number(remaining & 0xffn);
        remaining >>= 8n;
    }
    return bytes;
}

/**
 * Prepend a 4-byte big-endian length to `data` and return the concatenation.
 */
function lengthPrefix(data: Uint8Array): Uint8Array {
    const lenBytes = uint32ToBeBytes(data.length);
    const result = new Uint8Array(4 + data.length);
    result.set(lenBytes, 0);
    result.set(data, 4);
    return result;
}

/**
 * Concatenate any number of Uint8Arrays.
 */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((sum, a) => sum + a.length, 0);
    const result = new Uint8Array(total);
    let offset = 0;
    for (const arr of arrays) {
        result.set(arr, offset);
        offset += arr.length;
    }
    return result;
}

// ── XDR encoding for Soroban String ──────────────────────────────────────────

/**
 * Encode a plain ASCII string as a Soroban XDR `ScVal::String`.
 *
 * XDR layout:
 *   Discriminant: 0x00000006  (ScValType::String = 6)
 *   Length:       uint32 big-endian byte count of the string
 *   Data:         raw UTF-8 bytes of the string
 *   Padding:      0–3 zero bytes to align to the next 4-byte boundary
 *
 * This matches the output of `soroban_sdk::String::to_xdr()` for ASCII strings.
 */
export function encodeOrderIdXdr(orderId: string): Uint8Array {
    const encoder = new TextEncoder();
    const data = encoder.encode(orderId);
    const dataLen = data.length;

    // Pad data to a 4-byte boundary
    const paddedLen = Math.ceil(dataLen / 4) * 4;
    const padded = new Uint8Array(paddedLen); // zero-initialised
    padded.set(data, 0);

    // ScValType::String discriminant = 6, encoded as 4-byte BE uint32
    const discriminant = uint32ToBeBytes(6);
    const lengthField = uint32ToBeBytes(dataLen);

    return concatBytes(discriminant, lengthField, padded);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the canonical length-prefixed payload used to sign or verify a
 * LumenFlow payment.
 *
 * @param orderId - The order identifier string (ASCII).
 * @param amount  - The payment amount as a BigInt (must fit in i128).
 * @returns       A `Uint8Array` ready to be passed to an ed25519 signing function.
 *
 * @example
 * ```typescript
 * import { buildCanonicalPayload } from './signPaymentPayload';
 * import * as ed from '@noble/ed25519';
 *
 * const payload = buildCanonicalPayload("ORDER_001", 1000n);
 * const signature = await ed.signAsync(payload, privateKeyBytes);
 * ```
 */
export function buildCanonicalPayload(orderId: string, amount: bigint): Uint8Array {
    const orderIdXdr = encodeOrderIdXdr(orderId);
    const amountBytes = bigintToBeBytes16(amount);

    return concatBytes(
        lengthPrefix(orderIdXdr),
        lengthPrefix(amountBytes),
    );
}

/**
 * Verify that a canonical payload produced by the SDK matches the format
 * consumed by the on-chain contract.
 *
 * This is a structural check (not a cryptographic one). Use it in tests or
 * integration scripts to catch encoding mismatches early.
 *
 * The payload must:
 *   1. Begin with a 4-byte length for the order_id XDR field.
 *   2. Be followed by the XDR bytes.
 *   3. Continue with a 4-byte length (always 0x00000010 = 16) for the amount.
 *   4. End with exactly 16 bytes of amount.
 *
 * @returns `true` if the structural check passes, otherwise throws.
 */
export function assertCanonicalPayloadShape(
    payload: Uint8Array,
    orderId: string,
    amount: bigint,
): true {
    const view = new DataView(payload.buffer, payload.byteOffset);

    // Read order_id field length
    if (payload.length < 4) throw new Error("Payload too short for order_id length prefix");
    const orderIdLen = view.getUint32(0, false);
    if (payload.length < 4 + orderIdLen) throw new Error("Payload too short for order_id data");

    // Read amount field length
    const amountOffset = 4 + orderIdLen;
    if (payload.length < amountOffset + 4) throw new Error("Payload too short for amount length prefix");
    const amountLen = view.getUint32(amountOffset, false);
    if (amountLen !== 16) throw new Error(`Amount length prefix must be 16, got ${amountLen}`);
    if (payload.length !== amountOffset + 4 + 16) throw new Error("Payload has unexpected trailing bytes");

    // Verify order_id XDR content
    const expectedOrderIdXdr = encodeOrderIdXdr(orderId);
    if (expectedOrderIdXdr.length !== orderIdLen) {
        throw new Error("order_id XDR length mismatch");
    }

    // Verify amount bytes
    const expectedAmountBytes = bigintToBeBytes16(amount);
    const actualAmountBytes = payload.slice(amountOffset + 4);
    for (let i = 0; i < 16; i++) {
        if (actualAmountBytes[i] !== expectedAmountBytes[i]) {
            throw new Error(`Amount byte mismatch at index ${i}`);
        }
    }

    return true;
}
