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

/* ------------------------------------------------------------------------- *
 * GDPR right-to-erasure workflow for off-chain payer data (issue #1602)
 * ------------------------------------------------------------------------- *
 *
 * IMPORTANT — on-chain data is immutable and OUT OF SCOPE for erasure:
 *
 *   - Soroban ledger entries (payer nonces, payer index entries, receipts
 *     anchored on-chain) are append-only. There is no delete operation on the
 *     contract, and rewriting history would break settlement integrity.
 *   - Therefore on-chain payer nonces and payer index entries are explicitly
 *     EXCLUDED from deletion. Only off-chain copies (caches, indexes, logs,
 *     receipt blobs) are erased by this workflow.
 *   - See docs/PRIVACY.md for the on-chain vs. off-chain data table.
 *
 * The workflow below is a pure state machine: `requestErasure` validates and
 * stamps a request, `executeErasure` performs the off-chain deletions through
 * an injected store and emits a structured audit log entry.
 */

/** Off-chain data categories that may be erased. */
export type OffChainCategory =
  | "nonces"
  | "payerIndexCache"
  | "receipts"
  | "logs";

/** All off-chain categories erased by a completed erasure. */
export const OFF_CHAIN_CATEGORIES: readonly OffChainCategory[] = [
  "nonces",
  "payerIndexCache",
  "receipts",
  "logs",
];

/** Maximum number of days allowed between request and completion (GDPR). */
export const ERASURE_DEADLINE_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** A validated right-to-erasure request for a payer's off-chain data. */
export interface ErasureRequest {
  /** Stable identifier for the erasure request (used in the audit log). */
  requestId: string;
  /** Payer identity whose off-chain data is to be erased. */
  subject: string;
  /** ISO-8601 timestamp at which the request was received. */
  requestedAt: string;
  /** Documented legal basis (required for privileged roles). */
  legalBasis?: string;
  /** Role the requester is acting under. Default: `self`. */
  role?: DeletionRole;
}

/** Structured audit log entry emitted when an erasure completes. */
export interface ErasureAuditEntry {
  requestId: string;
  subject: string;
  requestedAt: string;
  completedAt: string;
  categories: OffChainCategory[];
  outcome: "completed" | "partial" | "failed";
}

/** Result of executing an erasure request. */
export interface ErasureResult {
  /** `pending` ⇒ accepted, awaiting execution; `completed` ⇒ erased. */
  status: "pending" | "completed" | "rejected";
  /** ISO-8601 deadline by which the erasure must complete. */
  deadline: string;
  /** Off-chain categories actually deleted (empty while pending). */
  deletedCategories: OffChainCategory[];
  /** Audit log entry; present once execution has been attempted. */
  auditEntry?: ErasureAuditEntry;
  /** Reason, populated when `status === "rejected"`. */
  reason?: string;
}

/**
 * Storage abstraction for off-chain payer data. Implementations delete the
 * off-chain copies only; on-chain Soroban entries are never touched.
 */
export interface OffChainPayerStore {
  /** Delete off-chain payer nonces for `subject`. */
  deleteNonces(subject: string): Promise<void> | void;
  /** Delete off-chain payer index cache entries for `subject`. */
  deletePayerIndexCache(subject: string): Promise<void> | void;
  /** Delete off-chain receipt blobs for `subject`. */
  deleteReceipts(subject: string): Promise<void> | void;
  /** Delete off-chain logs referencing `subject`. */
  deleteLogs(subject: string): Promise<void> | void;
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * MS_PER_DAY).toISOString();
}

/**
 * Validate and record a right-to-erasure request. Returns a `pending` request
 * with a 30-day deadline, or a `rejected` result when authorization fails.
 */
export function requestErasure(
  req: ErasureRequest,
  now: Date = new Date(),
): ErasureResult {
  const decision = authorizeDeletionRequest({
    requester: req.subject,
    subject: req.subject,
    role: req.role ?? "self",
    legalBasis: req.legalBasis,
  });

  const requestedAt = req.requestedAt || now.toISOString();
  const deadline = addDays(requestedAt, ERASURE_DEADLINE_DAYS);

  if (decision.outcome !== "allow") {
    return {
      status: "rejected",
      deadline,
      deletedCategories: [],
      reason: decision.reason,
    };
  }

  return { status: "pending", deadline, deletedCategories: [] };
}

/**
 * Execute a previously accepted erasure request against the off-chain store.
 *
 * Refuses to run once the 30-day deadline has passed. On-chain Soroban nonces
 * and payer index entries are immutable and are NOT deleted here.
 */
export async function executeErasure(
  request: ErasureRequest,
  store: OffChainPayerStore,
  now: Date = new Date(),
): Promise<ErasureResult> {
  const requestedAt = request.requestedAt;
  const deadline = addDays(requestedAt, ERASURE_DEADLINE_DAYS);
  const completedAt = now.toISOString();

  if (now.getTime() > new Date(deadline).getTime()) {
    return {
      status: "rejected",
      deadline,
      deletedCategories: [],
      reason: `erasure deadline of ${ERASURE_DEADLINE_DAYS} days exceeded`,
    };
  }

  const deleted: OffChainCategory[] = [];
  const failures: OffChainCategory[] = [];

  const steps: Array<[OffChainCategory, () => Promise<void> | void]> = [
    ["nonces", () => store.deleteNonces(request.subject)],
    ["payerIndexCache", () => store.deletePayerIndexCache(request.subject)],
    ["receipts", () => store.deleteReceipts(request.subject)],
    ["logs", () => store.deleteLogs(request.subject)],
  ];

  for (const [category, run] of steps) {
    try {
      await run();
      deleted.push(category);
    } catch {
      failures.push(category);
    }
  }

  const outcome: ErasureAuditEntry["outcome"] =
    failures.length === 0 ? "completed" : deleted.length === 0 ? "failed" : "partial";

  const auditEntry: ErasureAuditEntry = {
    requestId: request.requestId,
    subject: request.subject,
    requestedAt,
    completedAt,
    categories: deleted,
    outcome,
  };

  return {
    status: outcome === "failed" ? "rejected" : "completed",
    deadline,
    deletedCategories: deleted,
    auditEntry,
    ...(outcome === "failed"
      ? { reason: "all off-chain deletions failed" }
      : {}),
  };
}
