import { randomBytes } from "crypto";
import {
  encryptField,
  decryptField,
  isEncryptedEnvelope,
  rotateEnvelope,
  Keyring,
} from "../../security/dataEncryption";

const k1 = { keyId: "k1", key: randomBytes(32) };
const k2 = { keyId: "k2", key: randomBytes(32) };

describe("dataEncryption", () => {
  it("round-trips a sensitive field", () => {
    const ring: Keyring = { primary: k1 };
    const env = encryptField("DE89 3704 0044 0532 0130 00", ring);
    expect(isEncryptedEnvelope(env)).toBe(true);
    expect(env).not.toContain("3704");
    expect(decryptField(env, ring)).toBe("DE89 3704 0044 0532 0130 00");
  });

  it("produces a fresh IV each call (distinct ciphertext for same input)", () => {
    const ring: Keyring = { primary: k1 };
    expect(encryptField("x", ring)).not.toBe(encryptField("x", ring));
  });

  it("decrypts an old envelope after key rotation", () => {
    const oldRing: Keyring = { primary: k1 };
    const env = encryptField("secret", oldRing);
    const newRing: Keyring = {
      primary: k2,
      previous: [{ ...k1, active: false }],
    };
    expect(decryptField(env, newRing)).toBe("secret");
    const rotated = rotateEnvelope(env, newRing);
    expect(rotated).toContain(".k2.");
  });

  it("rejects a tampered ciphertext", () => {
    const ring: Keyring = { primary: k1 };
    const env = encryptField("secret", ring);
    const tampered = env.slice(0, -2) + (env.endsWith("AA") ? "BB" : "AA");
    expect(() => decryptField(tampered, ring)).toThrow();
  });

  it("throws when the keyId is not in the keyring", () => {
    const env = encryptField("x", { primary: k1 });
    expect(() => decryptField(env, { primary: k2 })).toThrow(/no key/);
  });

  it("rejects an under-sized key", () => {
    expect(() =>
      encryptField("x", { primary: { keyId: "bad", key: Buffer.alloc(8) } })
    ).toThrow(/AES-256/);
  });
});
