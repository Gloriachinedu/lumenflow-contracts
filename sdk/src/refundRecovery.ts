/**
 * LumenFlow SDK — interrupted-refund recovery.
 *
 * A client-driven refund walks through three contract calls:
 *
 *   initiate_refund  →  approve_refund  →  execute_refund
 *   (Pending)           (Approved)         (Completed)
 *
 * If the client process crashes, loses connectivity, or is killed between two
 * of those calls — or *during* one of them, where the transaction may have
 * actually landed on-chain even though the client saw a network error — the
 * refund is left in an intermediate state.
 *
 * {@link recoverRefund} reconciles against the authoritative on-chain refund
 * record and resumes from wherever the refund actually is. It is safe to call
 * repeatedly and safe to call after a fully-completed refund (it becomes a
 * no-op). The one thing it will not do is silently override a `Rejected` or
 * `Disputed` refund — those require the dispute flow and human review.
 *
 * See `docs/refund-lifecycle.md` for the full state machine.
 */

import { RefundRecord, RefundStatus } from './types';
import { LumenFlowError, PaymentErrorCode } from './errors';

/** A single contract call the recovery routine may perform. */
export type RefundStep = 'initiate' | 'approve' | 'execute';

/** How far the recovery is allowed to drive the refund. */
export type RefundPhase = 'initiated' | 'approved' | 'executed';

const PHASE_ORDER: Record<RefundPhase, number> = {
  initiated: 0,
  approved: 1,
  executed: 2,
};

/** Contract operations the recovery routine depends on (injectable for tests). */
export interface RefundOps {
  /**
   * Fetch the current refund record. Must return `null` (or throw
   * `LumenFlowError` with code `RefundNotFound`) when the refund does not exist.
   */
  getRefund(refundId: string): Promise<RefundRecord | null>;
  initiateRefund(params: {
    caller: string;
    refundId: string;
    orderId: string;
    amount: bigint;
    reason: string;
  }): Promise<void>;
  approveRefund(caller: string, refundId: string): Promise<void>;
  executeRefund(refundId: string): Promise<void>;
}

export interface RecoverRefundParams {
  refundId: string;
  orderId: string;
  amount: bigint;
  reason: string;
  /** Address authorised to initiate and approve the refund (merchant/admin). */
  caller: string;
  /** Highest phase to drive the refund to. Default: `executed`. */
  targetPhase?: RefundPhase;
  /** Max transient-failure retries per step. Default: 3. */
  maxRetriesPerStep?: number;
  /**
   * Classifies an error thrown by a contract op as transient (safe to retry)
   * vs. permanent. Defaults to {@link defaultIsTransient}.
   */
  isTransient?: (err: unknown) => boolean;
}

export interface RecoverRefundResult {
  refundId: string;
  finalStatus: RefundStatus;
  /** Steps actually performed during this run, in order. */
  stepsApplied: RefundStep[];
  /** true when the refund was already at/beyond the target phase on entry. */
  alreadyComplete: boolean;
}

/** Raised when the refund cannot be recovered without human/dispute action. */
export class RefundRecoveryError extends Error {
  constructor(
    message: string,
    readonly refundId: string,
    readonly status?: RefundStatus,
  ) {
    super(message);
    this.name = 'RefundRecoveryError';
  }
}

/**
 * Default heuristic: `LumenFlowError` is a deterministic contract-level result
 * and is never retried; anything that looks like a network/timeout/5xx failure
 * is transient.
 */
export function defaultIsTransient(err: unknown): boolean {
  if (err instanceof LumenFlowError) return false;
  if (err instanceof TypeError) return true; // fetch network failure
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('timeout') ||
      msg.includes('timed out') ||
      msg.includes('network') ||
      msg.includes('econnreset') ||
      msg.includes('econnrefused') ||
      msg.includes('socket hang up') ||
      msg.includes('502') ||
      msg.includes('503') ||
      msg.includes('504')
    );
  }
  return false;
}

function isRefundNotFound(err: unknown): boolean {
  return err instanceof LumenFlowError && err.code === PaymentErrorCode.RefundNotFound;
}

/** Maps a refund status to the phase it represents (or -1 if it doesn't exist). */
function phaseOf(status: RefundStatus | null): number {
  switch (status) {
    case RefundStatus.Pending:
      return PHASE_ORDER.initiated;
    case RefundStatus.Approved:
      return PHASE_ORDER.approved;
    case RefundStatus.Completed:
      return PHASE_ORDER.executed;
    default:
      return -1;
  }
}

/**
 * Reconcile an interrupted refund against on-chain state and resume it.
 *
 * @throws {RefundRecoveryError} when the refund is `Rejected`/`Disputed`, or
 *         when a step cannot be confirmed after exhausting retries.
 */
export async function recoverRefund(
  ops: RefundOps,
  params: RecoverRefundParams,
): Promise<RecoverRefundResult> {
  const {
    refundId,
    orderId,
    amount,
    reason,
    caller,
    targetPhase = 'executed',
    maxRetriesPerStep = 3,
    isTransient = defaultIsTransient,
  } = params;

  const target = PHASE_ORDER[targetPhase];
  const stepsApplied: RefundStep[] = [];

  const readStatus = async (): Promise<RefundStatus | null> => {
    try {
      const record = await ops.getRefund(refundId);
      return record ? record.status : null;
    } catch (err) {
      if (isRefundNotFound(err)) return null;
      throw err;
    }
  };

  let status = await readStatus();

  // Terminal states that recovery must not touch.
  if (status === RefundStatus.Rejected) {
    throw new RefundRecoveryError(
      `refund ${refundId} was rejected by the merchant; escalate via the dispute flow`,
      refundId,
      status,
    );
  }
  if (status === RefundStatus.Disputed) {
    throw new RefundRecoveryError(
      `refund ${refundId} is under dispute and awaiting admin resolution`,
      refundId,
      status,
    );
  }

  const alreadyComplete = phaseOf(status) >= target;

  /**
   * Runs one contract call, tolerating the "the write landed but the client
   * saw a network error" case: after any failure it re-reads on-chain state and
   * accepts the step if the refund advanced. Transient errors are retried;
   * permanent (contract) errors abort immediately.
   */
  const runStep = async (
    step: RefundStep,
    invoke: () => Promise<void>,
    reachedTarget: (s: RefundStatus | null) => boolean,
  ): Promise<void> => {
    for (let attempt = 1; attempt <= maxRetriesPerStep + 1; attempt++) {
      try {
        await invoke();
        stepsApplied.push(step);
        return;
      } catch (err) {
        const observed = await readStatus();
        if (reachedTarget(observed)) {
          // The transaction actually committed despite the client-side error.
          stepsApplied.push(step);
          status = observed;
          return;
        }
        if (isRefundNotFound(err) && step !== 'initiate') {
          throw new RefundRecoveryError(
            `refund ${refundId} vanished while applying '${step}'`,
            refundId,
            observed ?? undefined,
          );
        }
        if (!isTransient(err) || attempt === maxRetriesPerStep + 1) {
          throw err;
        }
      }
    }
  };

  // Walk the state machine until we reach the target phase.
  let guard = 0;
  while (phaseOf(status) < target) {
    if (guard++ > 4) {
      throw new RefundRecoveryError(
        `refund ${refundId} did not converge (stuck at ${status ?? 'missing'})`,
        refundId,
        status ?? undefined,
      );
    }

    if (status === null) {
      await runStep(
        'initiate',
        () => ops.initiateRefund({ caller, refundId, orderId, amount, reason }),
        (s) => phaseOf(s) >= PHASE_ORDER.initiated,
      );
    } else if (status === RefundStatus.Pending) {
      await runStep(
        'approve',
        () => ops.approveRefund(caller, refundId),
        (s) => phaseOf(s) >= PHASE_ORDER.approved,
      );
    } else if (status === RefundStatus.Approved) {
      await runStep(
        'execute',
        () => ops.executeRefund(refundId),
        (s) => phaseOf(s) >= PHASE_ORDER.executed,
      );
    } else if (status === RefundStatus.Rejected || status === RefundStatus.Disputed) {
      throw new RefundRecoveryError(
        `refund ${refundId} entered ${status} during recovery`,
        refundId,
        status,
      );
    }

    status = await readStatus();
  }

  return {
    refundId,
    finalStatus: status ?? RefundStatus.Pending,
    stepsApplied,
    alreadyComplete,
  };
}
