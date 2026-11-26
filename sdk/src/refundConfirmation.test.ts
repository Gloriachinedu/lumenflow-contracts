import {
  buildRefundConfirmationPrompt,
  confirmRefundAction,
  formatStroops,
  waitForRefundConfirmation,
  TimeoutError,
} from './refundConfirmation';

describe('formatStroops', () => {
  it('formats whole XLM values', () => {
    expect(formatStroops(10_000_000n)).toBe('1 XLM');
    expect(formatStroops(100_000_000n)).toBe('10 XLM');
  });

  it('formats fractional XLM values', () => {
    expect(formatStroops(12_500_000n)).toBe('1.25 XLM');
    expect(formatStroops(1n)).toBe('0.0000001 XLM');
  });
});

describe('buildRefundConfirmationPrompt', () => {
  const base = {
    refundId: 'rfnd-001',
    action: 'execute' as const,
    amountStroops: 50_000_000n,
    orderId: 'order-42',
    reason: 'Item not received',
  };

  it('populates all fields', () => {
    const prompt = buildRefundConfirmationPrompt(base);
    expect(prompt.refundId).toBe('rfnd-001');
    expect(prompt.amountDisplay).toBe('5 XLM');
    expect(prompt.action).toBe('execute');
    expect(prompt.warningMessage).toContain('cannot be undone');
  });

  it('includes appropriate warning for reject action', () => {
    const prompt = buildRefundConfirmationPrompt({ ...base, action: 'reject' });
    expect(prompt.warningMessage).toContain('permanent');
  });

  it('includes appropriate warning for dispute action', () => {
    const prompt = buildRefundConfirmationPrompt({ ...base, action: 'dispute' });
    expect(prompt.warningMessage).toContain('admin');
  });
});

describe('confirmRefundAction', () => {
  const prompt = buildRefundConfirmationPrompt({
    refundId: 'rfnd-002',
    action: 'execute',
    amountStroops: 20_000_000n,
    orderId: 'order-99',
    reason: 'Damaged goods',
  });

  it('returns confirmed=true when confirmFn resolves true', async () => {
    const result = await confirmRefundAction(prompt, {
      confirmFn: async () => true,
    });
    expect(result.confirmed).toBe(true);
    if (result.confirmed) {
      expect(result.confirmedAt).toBeInstanceOf(Date);
    }
  });

  it('returns confirmed=false with user_cancelled when confirmFn resolves false', async () => {
    const result = await confirmRefundAction(prompt, {
      confirmFn: async () => false,
    });
    expect(result.confirmed).toBe(false);
    if (!result.confirmed) {
      expect(result.reason).toBe('user_cancelled');
    }
  });

  it('returns confirmed=false with timeout when confirmFn takes too long', async () => {
    const result = await confirmRefundAction(prompt, {
      timeoutMs: 10,
      confirmFn: () => new Promise((resolve) => setTimeout(() => resolve(true), 500)),
    });
    expect(result.confirmed).toBe(false);
    if (!result.confirmed) {
      expect(result.reason).toBe('timeout');
    }
  });
});

describe('waitForRefundConfirmation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const completedRecord = {
    refundId: 'rfnd-100',
    status: 'Completed' as const,
    amountStroops: 10_000_000n,
  };

  it('resolves with the RefundRecord when status becomes Completed on the second poll', async () => {
    const getRefundStatus = jest
      .fn()
      .mockResolvedValueOnce({ refundId: 'rfnd-100', status: 'Pending' })
      .mockResolvedValueOnce(completedRecord);

    const promise = waitForRefundConfirmation('rfnd-100', {
      timeout: 30000,
      interval: 2000,
      getRefundStatus,
    });

    await jest.advanceTimersByTimeAsync(2000);
    const result = await promise;

    expect(result).toEqual(completedRecord);
    expect(getRefundStatus).toHaveBeenCalledTimes(2);
  });

  it('rejects with TimeoutError when status never reaches Completed within the timeout', async () => {
    const getRefundStatus = jest
      .fn()
      .mockResolvedValue({ refundId: 'rfnd-100', status: 'Pending' });

    const promise = waitForRefundConfirmation('rfnd-100', {
      timeout: 30000,
      interval: 2000,
      getRefundStatus,
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);

    await jest.advanceTimersByTimeAsync(30000);
    await assertion;
  });

  it('surfaces a non-retryable error from getRefundStatus immediately', async () => {
    const error = new Error('refund not found');
    const getRefundStatus = jest.fn().mockRejectedValue(error);

    const promise = waitForRefundConfirmation('rfnd-100', {
      timeout: 30000,
      interval: 2000,
      getRefundStatus,
    });
    const assertion = expect(promise).rejects.toBe(error);

    await jest.advanceTimersByTimeAsync(0);
    await assertion;
    expect(getRefundStatus).toHaveBeenCalledTimes(1);
  });

  it('clears pending timers after timing out', async () => {
    const getRefundStatus = jest
      .fn()
      .mockResolvedValue({ refundId: 'rfnd-100', status: 'Pending' });

    const promise = waitForRefundConfirmation('rfnd-100', {
      timeout: 30000,
      interval: 2000,
      getRefundStatus,
    });
    const assertion = expect(promise).rejects.toBeInstanceOf(TimeoutError);

    await jest.advanceTimersByTimeAsync(30000);
    await assertion;

    expect(jest.getTimerCount()).toBe(0);
  });
});
