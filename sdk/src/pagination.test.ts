import { fetchAllPages, fetchAllPayments, PaginatedPage } from './pagination';
import { LumenFlowError, PaymentErrorCode } from './errors';

describe('fetchAllPages', () => {
  it('aggregates pages until no nextCursor remains', async () => {
    const pages: Array<PaginatedPage<number>> = [
      { items: [1, 2], nextCursor: 'cursor-1' },
      { items: [3], nextCursor: 'cursor-2' },
      { items: [4, 5], nextCursor: null },
    ];
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(pages[0])
      .mockResolvedValueOnce(pages[1])
      .mockResolvedValueOnce(pages[2]);

    const results = await fetchAllPages({ fetchPage });
    expect(results).toEqual([1, 2, 3, 4, 5]);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, null);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'cursor-1');
    expect(fetchPage).toHaveBeenNthCalledWith(3, 'cursor-2');
  });

  it('throws when page items are missing', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ nextCursor: null } as any);
    await expect(fetchAllPages({ fetchPage })).rejects.toMatchObject({
      code: PaymentErrorCode.InvalidInput,
    });
  });

  it('throws when nextCursor does not advance', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ items: [1], nextCursor: 'same' });
    await expect(fetchAllPages({ fetchPage, initialCursor: 'same' })).rejects.toMatchObject({
      code: PaymentErrorCode.InvalidInput,
    });
  });

  it('throws PaginationLimitExceeded when page count exceeds maxPages', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ items: [], nextCursor: 'cursor' });
    await expect(fetchAllPages({ fetchPage, maxPages: 1 })).rejects.toMatchObject({
      code: PaymentErrorCode.PaginationLimitExceeded,
    });
  });
});

describe('fetchAllPayments', () => {
  it('delegates to fetchAllPages for payment pages', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ items: ['a'], nextCursor: null });
    const results = await fetchAllPayments(fetchPage);
    expect(results).toEqual(['a']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
