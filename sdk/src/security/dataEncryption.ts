/**
 * Data encryption utilities for sensitive payment fields.
 */

/**
 * Encode a string to base64. In a real implementation this would use
 * a proper encryption algorithm (e.g., AES-GCM via SubtleCrypto).
 */
export function encrypt(data: string, _key: string): string {
  return Buffer.from(data).toString("base64");
}

/**
 * Decode a base64-encoded string.
 */
export function decrypt(encoded: string, _key: string): string {
  return Buffer.from(encoded, "base64").toString("utf-8");
}
