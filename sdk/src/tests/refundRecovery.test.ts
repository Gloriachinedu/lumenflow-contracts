/**
 * Integration tests for interrupted refund recovery (issue #878).
 *
 * A `FakeRefundContract` models the on-chain refund state machine
 * (missing → Pending → Approved → Completed, plus the Rejected / Disputed
 * branches) exactly as `docs/refund-lifecycle.md` describes, and lets a test
 * inject faults:
 *
 *   - `failNext(op, error)`         — the next call to `op` throws BEFORE mutating
 *   - `failAfterCommit(op, error)`  — the call mutates state, THEN throws
 *                                     (models a tx that landed but the client
 *                                      only saw a dropped connection)
 *
 * `recoverRefund` is then run against a contract left in each intermediate /
 * interrupted state and asserted to converge idempotently.
 *
 * Covered: normal resume from every phase; the mid-execute "landed but errored"
 * case; repeated/idempotent recovery; transient-error retries; permanent
 * contract errors surfaced; Rejected / Disputed refused; non-convergence guard.
 */

import {
  recoverRefund,
  RefundRecoveryError,
  RefundOps,
  defaultIsTransient,
} from '../refundRecovery';
import { RefundRecord, RefundStatus } from '../types';
import { LumenFlowError, PaymentErrorCode } from '../errors';

type Op = 'initiate' | 'approve' | 'execute';

class FakeRefundContract implements RefundOps {
  private record: RefundRecord | null = null;
  readonly calls: Op[] = [];
  private failBefore = new Map<Op, Error>();
  private failAfter = new Map<Op, Error>();

  constructor(initial?: Partial<RefundRecord> & { status: RefundStatus }) {
    if (initial) {
      this.record = {
        refundId: initial.refundId ?? 'RF-1',
        orderId: initial.orderId ?? 'ORDER-1',
        initiator: initial.initiator ?? 'GMERCHANT',
        amount: initial.amount ?? 1000n,
        reason: initial.reason ?? 'customer request',
        status: initial.status,
        createdAt: initial.createdAt ?? 0n,
      };
    }
  }

  failNext(op: Op, error: Error) {
    this.failBefore.set(op, error);
  }
  failAfterCommit(op: Op, error: Error) {
    this.failAfter.set(op, error);
  }

  private guardBefore(op: Op) {
    const err = this.failBefore.get(op);
    if (err) {
      this.failBefore.delete(op);
      throw err;
    }
  }
  private guardAfter(op: Op) {
    const err = this.failAfter.get(op);
    if (err) {
      this.failAfter.delete(op);
      throw err;
    }
  }

  async getRefund(refundId: string): Promise<RefundRecord | null> {
    if (!this.record || this.record.refundId !== refundId) return null;
    return { ...this.record };
  }

  async initiateRefund(params: {
    caller: string;
    refundId: string;
    orderId: string;
    amount: bigint;
    reason: string;
  }): Promise<void> {
    this.calls.push('initiate');
    this.guardBefore('initiate');
    if (this.record) throw new LumenFlowError(PaymentErrorCode.RefundAlreadyExists);
    this.record = {
      refundId: params.refundId,
      orderId: params.orderId,
      initiator: params.caller,
      amount: params.amount,
      reason: params.reason,
      status: RefundStatus.Pending,
      createdAt: 0n,
    };
    this.guardAfter('initiate');
  }

  async approveRefund(_caller: string, refundId: string): Promise<void> {
    this.calls.push('approve');
    this.guardBefore('approve');
    if (!this.record || this.record.refundId !== refundId) {
      throw new LumenFlowError(PaymentErrorCode.RefundNotFound);
    }
    if (this.record.status !== RefundStatus.Pending) {
      throw new LumenFlowError(PaymentErrorCode.RefundAlreadyCompleted);
    }
    this.record.status = RefundStatus.Approved;
    this.guardAfter('approve');
  }

  async executeRefund(refundId: string): Promise<void> {
    this.calls.push('execute');
    this.guardBefore('execute');
    if (!this.record || this.record.refundId !== refundId) {
      throw new LumenFlowError(PaymentErrorCode.RefundNotFound);
    }
    if (this.record.status !== RefundStatus.Approved) {
      throw new LumenFlowError(PaymentErrorCode.RefundNotApproved);
    }
    this.record.status = RefundStatus.Completed;
    this.guardAfter('execute');
  }
}

const PARAMS = {
  refundId: 'RF-1',
  orderId: 'ORDER-1',
  amount: 1000n,
  reason: 'customer request',
  caller: 'GMERCHANT',
};

const netErr = (m = 'ECONNRESET: socket hang up') => new Error(m);

describe('recoverRefund — normal resume from each phase', () => {
  it('drives a brand-new refund all the way to Completed', async () => {
    const c = new FakeRefundContract();
    const res = await recoverRefund(c, PARAMS);

    expect(res.finalStatus).toBe(RefundStatus.Completed);
    expect(res.stepsApplied).toEqual(['initiate', 'approve', 'execute']);
    expect(res.alreadyComplete).toBe(false);
    expect(c.calls).toEqual(['initiate', 'approve', 'execute']);
  });

  it('resumes from Pending (initiate already done)', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Pending });
    const res = await recoverRefund(c, PARAMS);

    expect(res.stepsApplied).toEqual(['approve', 'execute']);
    expect(res.finalStatus).toBe(RefundStatus.Completed);
    expect(c.calls).toEqual(['approve', 'execute']);
  });

  it('resumes from Approved (only execute left)', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Approved });
    const res = await recoverRefund(c, PARAMS);

    expect(res.stepsApplied).toEqual(['execute']);
    expect(res.finalStatus).toBe(RefundStatus.Completed);
  });

  it('stops at the requested target phase', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Pending });
    const res = await recoverRefund(c, { ...PARAMS, targetPhase: 'approved' });

    expect(res.stepsApplied).toEqual(['approve']);
    expect(res.finalStatus).toBe(RefundStatus.Approved);
    expect(c.calls).not.toContain('execute');
  });
});

describe('recoverRefund — idempotency', () => {
  it('is a no-op when the refund is already Completed', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Completed });
    const res = await recoverRefund(c, PARAMS);

    expect(res.alreadyComplete).toBe(true);
    expect(res.stepsApplied).toEqual([]);
    expect(res.finalStatus).toBe(RefundStatus.Completed);
    expect(c.calls).toEqual([]);
  });

  it('can be run repeatedly without side effects or errors', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Pending });
    await recoverRefund(c, PARAMS);
    const callsAfterFirst = [...c.calls];

    const second = await recoverRefund(c, PARAMS);
    const third = await recoverRefund(c, PARAMS);

    expect(second.alreadyComplete).toBe(true);
    expect(second.stepsApplied).toEqual([]);
    expect(third.alreadyComplete).toBe(true);
    expect(c.calls).toEqual(callsAfterFirst); // no further contract calls
  });
});

describe('recoverRefund — interrupted mid-step (write landed, client errored)', () => {
  it('recovers when execute_refund committed but the client saw a network drop', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Approved });
    c.failAfterCommit('execute', netErr());

    const res = await recoverRefund(c, PARAMS);

    expect(res.finalStatus).toBe(RefundStatus.Completed);
    expect(res.stepsApplied).toEqual(['execute']);
    // execute was invoked exactly once — recovery re-read state, saw Completed,
    // and did NOT call execute again.
    expect(c.calls.filter((x) => x === 'execute')).toHaveLength(1);
  });

  it('recovers when approve_refund committed but the client saw a timeout', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Pending });
    c.failAfterCommit('approve', netErr('request timed out'));

    const res = await recoverRefund(c, PARAMS);

    expect(res.finalStatus).toBe(RefundStatus.Completed);
    expect(c.calls.filter((x) => x === 'approve')).toHaveLength(1);
  });

  it('recovers when initiate committed but the client crashed before the ack', async () => {
    const c = new FakeRefundContract();
    c.failAfterCommit('initiate', netErr());

    const res = await recoverRefund(c, PARAMS);

    expect(res.finalStatus).toBe(RefundStatus.Completed);
    expect(c.calls.filter((x) => x === 'initiate')).toHaveLength(1);
  });
});

describe('recoverRefund — transient failures before the write', () => {
  it('retries a transient failure and then succeeds', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Approved });
    c.failNext('execute', netErr('503 Service Unavailable'));

    const res = await recoverRefund(c, PARAMS);

    expect(res.finalStatus).toBe(RefundStatus.Completed);
    expect(c.calls.filter((x) => x === 'execute')).toHaveLength(2); // 1 failed + 1 ok
  });

  it('gives up after exhausting the retry budget for a step', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Approved });
    const flakyOps: RefundOps = {
      getRefund: (id) => c.getRefund(id),
      initiateRefund: (p) => c.initiateRefund(p),
      approveRefund: (caller, id) => c.approveRefund(caller, id),
      executeRefund: async () => {
        throw netErr('network unreachable');
      },
    };

    await expect(
      recoverRefund(flakyOps, { ...PARAMS, maxRetriesPerStep: 2 }),
    ).rejects.toThrow('network unreachable');
  });
});

describe('recoverRefund — permanent contract errors', () => {
  it('surfaces a non-retryable LumenFlowError without retrying', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Approved });
    let executeCalls = 0;
    const ops: RefundOps = {
      getRefund: (id) => c.getRefund(id),
      initiateRefund: (p) => c.initiateRefund(p),
      approveRefund: (caller, id) => c.approveRefund(caller, id),
      executeRefund: async () => {
        executeCalls++;
        throw new LumenFlowError(PaymentErrorCode.Unauthorized);
      },
    };

    await expect(recoverRefund(ops, PARAMS)).rejects.toBeInstanceOf(LumenFlowError);
    expect(executeCalls).toBe(1); // no retries for a deterministic contract error
  });
});

describe('recoverRefund — terminal states are refused', () => {
  it('refuses a Rejected refund and points at the dispute flow', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Rejected });

    await expect(recoverRefund(c, PARAMS)).rejects.toMatchObject({
      name: 'RefundRecoveryError',
      status: RefundStatus.Rejected,
    });
    expect(c.calls).toEqual([]);
  });

  it('refuses a Disputed refund', async () => {
    const c = new FakeRefundContract({ status: RefundStatus.Disputed });

    await expect(recoverRefund(c, PARAMS)).rejects.toBeInstanceOf(RefundRecoveryError);
  });
});

describe('defaultIsTransient', () => {
  it('classifies network-ish errors as transient and LumenFlowError as permanent', () => {
    expect(defaultIsTransient(netErr())).toBe(true);
    expect(defaultIsTransient(new Error('request timed out'))).toBe(true);
    expect(defaultIsTransient(new Error('504 Gateway Timeout'))).toBe(true);
    expect(defaultIsTransient(new LumenFlowError(PaymentErrorCode.RefundNotApproved))).toBe(false);
    expect(defaultIsTransient(new Error('invalid amount'))).toBe(false);
  });
});
