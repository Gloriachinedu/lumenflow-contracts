/**
 * Field-level minimization for merchant and payer records (issue #894).
 *
 * Different consumers of a record are entitled to different fields. Rather than
 * hand a full record to every caller and hope it strips what it must not show,
 * `minimizeRecord` projects a record down to an explicit per-audience
 * allow-list and masks the identifiers that are allowed but must not be shown
 * in the clear (email, phone, wallet address).
 *
 *   - `public`   — what may appear on a payment-link page / receipt
 *   - `partner`  — what an integrating partner API may read
 *   - `internal` — full record for first-party services (no minimization)
 *
 * Unknown fields are always dropped. Nested objects are not traversed; expose a
 * nested value by adding its dotted path is out of scope — flatten first.
 */

export type Audience = "public" | "partner" | "internal";

export interface MinimizeOptions {
  /** Mask (rather than drop) allowed identifier fields. Default: true. */
  maskIdentifiers?: boolean;
}

type Rec = Record<string, unknown>;

const MERCHANT_FIELDS: Record<Audience, ReadonlySet<string> | "*"> = {
  public: new Set(["id", "displayName", "logoUrl", "country"]),
  partner: new Set([
    "id",
    "displayName",
    "logoUrl",
    "country",
    "email",
    "walletAddress",
    "createdAt",
  ]),
  internal: "*",
};

const PAYER_FIELDS: Record<Audience, ReadonlySet<string> | "*"> = {
  public: new Set(["id"]),
  partner: new Set(["id", "email", "walletAddress", "country"]),
  internal: "*",
};

/** Identifier fields that are masked (not shown in the clear) below `internal`. */
const IDENTIFIER_FIELDS = new Set(["email", "phone", "walletAddress"]);

export function maskIdentifier(value: unknown): string {
  const s = String(value ?? "");
  const at = s.indexOf("@");
  if (at > 0) {
    const local = s.slice(0, at);
    const head = local.slice(0, Math.min(2, local.length));
    return `${head}${"*".repeat(Math.max(1, local.length - head.length))}${s.slice(at)}`;
  }
  if (s.length <= 4) return "*".repeat(s.length);
  return `${s.slice(0, 2)}${"*".repeat(s.length - 6)}${s.slice(-4)}`;
}

function project(
  record: Rec,
  allowed: ReadonlySet<string> | "*",
  maskIds: boolean
): Rec {
  if (allowed === "*") return { ...record };
  const out: Rec = {};
  for (const key of allowed) {
    if (!(key in record)) continue;
    const value = record[key];
    out[key] =
      maskIds && IDENTIFIER_FIELDS.has(key) && value != null && value !== ""
        ? maskIdentifier(value)
        : value;
  }
  return out;
}

/**
 * Project a merchant record to the fields `audience` is entitled to.
 *
 * @throws if `record` is not a plain object or `audience` is unknown.
 */
export function minimizeMerchantRecord(
  record: Rec,
  audience: Audience,
  options: MinimizeOptions = {}
): Rec {
  const allowed = MERCHANT_FIELDS[audience];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("record must be a plain object");
  }
  if (allowed === undefined) throw new Error(`unknown audience: ${String(audience)}`);
  return project(record, allowed, options.maskIdentifiers ?? true);
}

/**
 * Project a payer record to the fields `audience` is entitled to.
 *
 * @throws if `record` is not a plain object or `audience` is unknown.
 */
export function minimizePayerRecord(
  record: Rec,
  audience: Audience,
  options: MinimizeOptions = {}
): Rec {
  const allowed = PAYER_FIELDS[audience];
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw new Error("record must be a plain object");
  }
  if (allowed === undefined) throw new Error(`unknown audience: ${String(audience)}`);
  return project(record, allowed, options.maskIdentifiers ?? true);
}
