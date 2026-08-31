/**
 * LumenFlow SDK — User-visible confirmation for irreversible refund actions.
 *
 * Refund execution is irreversible once the contract's `execute_refund` call
 * lands on-chain.  This module provides a lightweight confirmation gate that
 * forces the caller to explicitly acknowledge the action before the SDK
 * proceeds.  UIs should surface the {@link RefundConfirmationPrompt} data to
 * the user and pass the resulting acknowledgement back via
 * {@link confirmRefundAction}.
 *
 * Integration points
 * ------------------
 * - Call {@link buildRefundConfirmationPrompt} with the refund details to get
 *   a structured prompt suitable for rendering in any frontend.
 * - Surface the prompt to the user (modal, confirmation dialog, etc.).
 * - Pass the user's response to {@link confirmRefundAction}.
 * - Only proceed to `recoverRefund` / `executeRefund` on a confirmed result.
 *
 * Closes #800.
 */

export type RefundActionType = 'execute' | 'reject' | 'dispute';

/** Human-readable data surfaced in the confirmation dialog. */
export interface RefundConfirmationPrompt {
  /** Unique ID of the refund being acted upon. */
  refundId: string;
  /** The action the user is about to take. */
  action: RefundActionType;
  /** Amount in stroops (1 XLM = 10_000_000 stroops). */
  amountStroops: bigint;
  /** Formatted amount string, e.g. "12.50 XLM". */
  amountDisplay: string;
  /** The order this refund is associated with. */
  orderId: string;
  /** Merchant-supplied reason for the refund. */
  reason: string;
  /**
   * Localised warning message explaining that the action cannot be undone.
   * Suitable for rendering directly in the UI.
   */
  warningMessage: string;
}

/** The result returned by {@link confirmRefundAction}. */
export type RefundConfirmationResult =
  | { confirmed: true; refundId: string; action: RefundActionType; confirmedAt: Date }
  | { confirmed: false; refundId: string; action: RefundActionType; reason: 'user_cancelled' | 'timeout' };

export interface ConfirmRefundOptions {
  /** Timeout in milliseconds before the confirmation is treated as cancelled. */
  timeoutMs?: number;
  /**
   * Injectable confirmation function — receives the prompt and returns a
   * boolean.  Defaults to a no-op that always resolves `false`; UIs must
   * supply their own implementation (e.g. a modal dialog).
   */
  confirmFn?: (prompt: RefundConfirmationPrompt) => Promise<boolean>;
}

const STROOPS_PER_XLM = 10_000_000n;

/** Format a stroops value as a human-readable XLM string. */
export function formatStroops(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_XLM;
  const frac = stroops % STROOPS_PER_XLM;
  const fracStr = frac.toString().padStart(7, '0').replace(/0+$/, '');
  return fracStr.length > 0 ? `${whole}.${fracStr} XLM` : `${whole} XLM`;
}

const ACTION_WARNINGS: Record<RefundActionType, string> = {
  execute:
    'This will immediately transfer the refund amount back to the payer. This action cannot be undone.',
  reject:
    'Rejecting a refund is permanent. The payer will be notified and the refund will be closed.',
  dispute:
    'Raising a dispute will escalate the refund to admin review. This cannot be reversed without admin action.',
};

/**
 * Build a {@link RefundConfirmationPrompt} from refund details.
 * Pass the result to your UI layer, then to {@link confirmRefundAction}.
 */
export function buildRefundConfirmationPrompt(params: {
  refundId: string;
  action: RefundActionType;
  amountStroops: bigint;
  orderId: string;
  reason: string;
}): RefundConfirmationPrompt {
  return {
    refundId: params.refundId,
    action: params.action,
    amountStroops: params.amountStroops,
    amountDisplay: formatStroops(params.amountStroops),
    orderId: params.orderId,
    reason: params.reason,
    warningMessage: ACTION_WARNINGS[params.action],
  };
}

/**
 * Present the confirmation prompt and await the user's decision.
 *
 * Returns a {@link RefundConfirmationResult} — callers must check
 * `result.confirmed` before proceeding with the irreversible action.
 *
 * @example
 * ```ts
 * const prompt = buildRefundConfirmationPrompt({ refundId, action: 'execute', ... });
 * const result = await confirmRefundAction(prompt, {
 *   confirmFn: (p) => showModal(p.warningMessage),
 *   timeoutMs: 30_000,
 * });
 * if (!result.confirmed) return; // user cancelled or timed out
 * await recoverRefund(ops, { refundId, ... });
 * ```
 */
export async function confirmRefundAction(
  prompt: RefundConfirmationPrompt,
  options: ConfirmRefundOptions = {},
): Promise<RefundConfirmationResult> {
  const { timeoutMs = 0, confirmFn = async () => false } = options;

  const confirmPromise = confirmFn(prompt);

  const userDecision = timeoutMs > 0
    ? await Promise.race([
        confirmPromise,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), timeoutMs)),
      ])
    : await confirmPromise;

  if (userDecision === 'timeout') {
    return { confirmed: false, refundId: prompt.refundId, action: prompt.action, reason: 'timeout' };
  }

  if (!userDecision) {
    return { confirmed: false, refundId: prompt.refundId, action: prompt.action, reason: 'user_cancelled' };
  }

  return {
    confirmed: true,
    refundId: prompt.refundId,
    action: prompt.action,
    confirmedAt: new Date(),
  };
}
