/**
 * Authenticated and authorized data deletion requests (issue #895).
 *
 * Client/edge-side validation for "delete my data" requests against merchant
 * and payer records. It enforces the authorization boundary before a delete is
 * forwarded to the backend/contract:
 *
 *   - the request must be authenticated (a resolved subject identity)
 *   - the requester may only delete their own record, unless they hold an
 *     `admin` / `compliance` role acting on a documented legal basis
 *   - records under an active legal hold or with unsettled payment obligations
 *     cannot be erased (data-integrity / regulatory retention)
 *   - an already-deleted record is a no-op, not an error
 */

export type DeletionRole = "self" | "admin" | "compliance";

export interface DeletionRequest {
  /** Authenticated identity making the request (wallet / user id). Empty ⇒ unauthenticated. */
  requester: string;
  /** Identity that owns the record being deleted. */
  subject: string;
  /** Role the requester is acting under. Default: `self`. */
  role?: DeletionRole;
  /** Free-text legal basis; required for `admin` / `compliance` deletions. */
  legalBasis?: string;
  /** Record is under a litigation / regulatory hold. */
  legalHold?: boolean;
  /** Record has payments that have not yet settled or refunded. */
  hasUnsettledObligations?: boolean;
  /** Record is already erased. */
  alreadyDeleted?: boolean;
}

export interface DeletionDecision {
  /** `allow` ⇒ forward the delete; `noop` ⇒ nothing to do; `deny` ⇒ reject. */
  outcome: "allow" | "noop" | "deny";
  /** Reason, empty when `outcome === "allow"`. */
  reason: string;
}

const PRIVILEGED: ReadonlySet<DeletionRole> = new Set(["admin", "compliance"]);

/**
 * Authorize a data deletion request. Pure and side-effect free.
 */
export function authorizeDeletionRequest(req: DeletionRequest): DeletionDecision {
  if (typeof req.requester !== "string" || req.requester.trim() === "") {
    return { outcome: "deny", reason: "request is not authenticated" };
  }
  if (typeof req.subject !== "string" || req.subject.trim() === "") {
    return { outcome: "deny", reason: "deletion subject is missing" };
  }

  const role: DeletionRole = req.role ?? "self";

  if (role === "self") {
    if (req.requester !== req.subject) {
      return {
        outcome: "deny",
        reason: "requester may only delete their own record",
      };
    }
  } else if (PRIVILEGED.has(role)) {
    if (typeof req.legalBasis !== "string" || req.legalBasis.trim() === "") {
      return {
        outcome: "deny",
        reason: `${role} deletion requires a documented legalBasis`,
      };
    }
  } else {
    return { outcome: "deny", reason: `unknown deletion role: ${String(role)}` };
  }

  if (req.alreadyDeleted) {
    return { outcome: "noop", reason: "record is already deleted" };
  }
  if (req.legalHold) {
    return {
      outcome: "deny",
      reason: "record is under a legal hold and cannot be erased",
    };
  }
  if (req.hasUnsettledObligations) {
    return {
      outcome: "deny",
      reason: "record has unsettled payment obligations; retain until settled",
    };
  }

  return { outcome: "allow", reason: "" };
}
