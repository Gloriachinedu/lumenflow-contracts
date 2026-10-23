/**
 * Encrypt sensitive merchant data at rest with managed keys (issue #893).
 *
 * Authenticated envelope encryption for individual sensitive fields (bank
 * details, tax id, API secrets) before they are persisted. Keys are supplied
 * by the caller's key-management layer as a keyring keyed by `keyId`, so key
 * rotation is a matter of adding a new active key while retaining old keys for
 * decryption only.
 *
 * Ciphertext is a self-describing string:
 *   `v1.<keyId>.<iv-b64url>.<tag-b64url>.<ciphertext-b64url>`
 *
 * AES-256-GCM provides confidentiality and integrity; `keyId` is bound into the
 * additional authenticated data so an envelope cannot be replayed under a
 * different key entry.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const SCHEME = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

export interface ManagedKey {
  keyId: string;
  /** 32-byte AES-256 key. */
  key: Buffer | Uint8Array;
  /** When false the key may decrypt but not encrypt (rotated-out). Default: true. */
  active?: boolean;
}

export interface Keyring {
  /** Key used for new encryptions. */
  primary: ManagedKey;
  /** Older keys retained for decryption only. */
  previous?: ManagedKey[];
}

function normalizeKey(k: ManagedKey): Buffer {
  const buf = Buffer.from(k.key);
  if (buf.length !== KEY_BYTES) {
    throw new Error(`key "${k.keyId}" must be ${KEY_BYTES} bytes (AES-256)`);
  }
  return buf;
}

/**
 * Encrypt `plaintext` with the keyring's primary key.
 *
 * @throws if the primary key is inactive or the wrong length.
 */
export function encryptField(plaintext: string, keyring: Keyring): string {
  const mk = keyring.primary;
  if (mk.active === false) {
    throw new Error(`primary key "${mk.keyId}" is not active for encryption`);
  }
  const key = normalizeKey(mk);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(`${SCHEME}.${mk.keyId}`));
  const ct = Buffer.concat([
    cipher.update(Buffer.from(String(plaintext), "utf8")),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    SCHEME,
    mk.keyId,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ct.toString("base64url"),
  ].join(".");
}

/**
 * Decrypt an envelope produced by {@link encryptField}, selecting the key by
 * its embedded `keyId`.
 *
 * @throws if the envelope is malformed, the key is unknown, or authentication
 *         fails (tampering / wrong key).
 */
export function decryptField(envelope: string, keyring: Keyring): string {
  const parts = String(envelope).split(".");
  if (parts.length !== 5 || parts[0] !== SCHEME) {
    throw new Error("malformed ciphertext envelope");
  }
  const [, keyId, ivRaw, tagRaw, ctRaw] = parts;

  const candidates = [keyring.primary, ...(keyring.previous ?? [])];
  const mk = candidates.find((k) => k.keyId === keyId);
  if (!mk) throw new Error(`no key in keyring for keyId "${keyId}"`);

  const decipher = createDecipheriv(
    "aes-256-gcm",
    normalizeKey(mk),
    Buffer.from(ivRaw, "base64url")
  );
  decipher.setAAD(Buffer.from(`${SCHEME}.${keyId}`));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(ctRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("ciphertext authentication failed (tampered or wrong key)");
  }
}

/** True when `value` is an envelope this module can decrypt. */
export function isEncryptedEnvelope(value: unknown): boolean {
  return typeof value === "string" && value.startsWith(`${SCHEME}.`) &&
    value.split(".").length === 5;
}

/** Re-encrypt an envelope under the keyring's current primary key. */
export function rotateEnvelope(envelope: string, keyring: Keyring): string {
  return encryptField(decryptField(envelope, keyring), keyring);
}
