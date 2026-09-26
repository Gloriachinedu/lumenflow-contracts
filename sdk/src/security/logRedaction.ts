/**
 * Redaction of sensitive values before they reach application or deployment
 * logs (issue #892).
 *
 * Logs are frequently shipped to third-party aggregators and retained far
 * longer than the data they describe. `redactSecrets` walks a string or an
 * arbitrary value and replaces anything that looks like a credential —
 * Stellar secret keys, PEM private-key blocks, bearer / basic `Authorization`
 * headers, API tokens, and the values of well-known secret-bearing keys — with
 * a fixed placeholder, so callers can log request context without leaking it.
 *
 * This is defence-in-depth, not a parser: prefer never putting a secret in a
 * log line in the first place. Use `redactSecrets` on anything you cannot
 * fully control (caught errors, upstream response bodies, request dumps).
 */

export const REDACTED = "[REDACTED]";

/** Normalize an object key for comparison against {@link SECRET_KEYS}. */
const normalizeKey = (k: string): string =>
  k.toLowerCase().replace(/[-\s]+/g, "_");

/** Object keys whose value is always replaced, regardless of its shape. */
const SECRET_KEYS = new Set(
  [
    "password",
    "passwd",
    "secret",
    "secretkey",
    "secret_key",
    "apikey",
    "api_key",
    "token",
    "access_token",
    "refresh_token",
    "auth_token",
    "authorization",
    "cookie",
    "set-cookie",
    "sessionid",
    "session_id",
    "privatekey",
    "private_key",
    "seed",
    "mnemonic",
    "adminkey",
    "admin_key",
    "merchantkey",
    "merchant_key",
    "payerkey",
    "payer_key",
    "sourceaccount",
    "source_account",
  ].map(normalizeKey)
);

const PATTERNS: RegExp[] = [
  // Stellar secret seed (S + 55 base32 chars)
  /\bS[A-Z2-7]{55}\b/g,
  // PEM private key blocks
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  // Authorization header values: "Bearer xxx", "Basic xxx"
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // GitHub tokens
  /\b(?:ghp_[A-Za-z0-9_]{36,}|github_pat_[A-Za-z0-9_]{82,})\b/g,
  // AWS access key IDs
  /\bAKIA[0-9A-Z]{16}\b/g,
  // key=value / key: value assignments for a secret-looking name
  /\b(password|passwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|private[_-]?key)\b(\s*[:=]\s*)("?)[^\s"',}]{6,}\3/gi,
];

/** Redact secrets found inside a single string. */
export function redactString(input: string): string {
  let out = input;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, (match, p1, p2) => {
      // Keep the leading scheme/key so the log stays readable.
      if (p2 !== undefined && /^\s*[:=]\s*$/.test(p2)) return `${p1}${p2}${REDACTED}`;
      if (typeof p1 === "string" && /^(bearer|basic)$/i.test(p1)) return `${p1} ${REDACTED}`;
      return REDACTED;
    });
  }
  return out;
}

/**
 * Recursively redact secrets from an arbitrary value so it is safe to log.
 *
 * - strings are scrubbed with {@link redactString}
 * - object values under a known secret key are replaced wholesale
 * - arrays and nested plain objects are traversed
 * - cycles are handled; non-plain objects (Error, Date, …) are stringified
 *
 * The input is never mutated.
 */
export function redactSecrets<T>(value: T, _seen?: WeakSet<object>): T {
  const seen = _seen ?? new WeakSet<object>();

  if (typeof value === "string") return redactString(value) as unknown as T;
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value as object)) return "[Circular]" as unknown as T;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, seen)) as unknown as T;
  }

  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    // Error, Date, custom classes — redact their string form only.
    return redactString(String(value)) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SECRET_KEYS.has(normalizeKey(key))
      ? REDACTED
      : redactSecrets(val, seen);
  }
  return out as unknown as T;
}

/**
 * Wrap a logger-like function so every argument is redacted before it is
 * emitted. Works with `console.log` and most structured loggers.
 *
 *   const log = redactingLogger(console.error);
 *   log("payment failed", { authorization: token });  // token never logged
 */
export function redactingLogger<A extends unknown[]>(
  sink: (...args: A) => void
): (...args: A) => void {
  return (...args: A) => sink(...(args.map((a) => redactSecrets(a)) as A));
}
