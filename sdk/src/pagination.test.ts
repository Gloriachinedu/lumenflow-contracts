import {
  fetchAllPages,
  fetchAllPayments,
  paginatePayments,
  paginateMerchants,
  PaginatedPage,
} from './pagination';
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

describe('paginatePayments', () => {
  it('yields all records from a single page', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ items: ['a', 'b'], nextCursor: null });
    const results: string[] = [];
    for await (const record of paginatePayments({ fetchPage })) {
      results.push(record);
    }
    expect(results).toEqual(['a', 'b']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('transparently fetches all pages and yields individual records', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ items: ['a', 'b'], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: ['c'], nextCursor: 'cursor-2' })
      .mockResolvedValueOnce({ items: ['d', 'e'], nextCursor: null });

    const results: string[] = [];
    for await (const record of paginatePayments({ fetchPage })) {
      results.push(record);
    }

    expect(results).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, null);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'cursor-1');
    expect(fetchPage).toHaveBeenNthCalledWith(3, 'cursor-2');
  });

  it('yields nothing for an empty result', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const results: string[] = [];
    for await (const record of paginatePayments({ fetchPage })) {
      results.push(record);
    }
    expect(results).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('propagates a typed LumenFlowError thrown mid-pagination', async () => {
    const error = new LumenFlowError(
      PaymentErrorCode.NetworkError,
      'network failed mid-pagination',
    );
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ items: ['a'], nextCursor: 'cursor-1' })
      .mockRejectedValueOnce(error);

    const results: string[] = [];
    await expect(
      (async () => {
        for await (const record of paginatePayments({ fetchPage })) {
          results.push(record);
        }
      })(),
    ).rejects.toBeInstanceOf(LumenFlowError);

    expect(results).toEqual(['a']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});

describe('paginateMerchants', () => {
  it('yields all records from a single page', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ items: ['m1', 'm2'], nextCursor: null });
    const results: string[] = [];
    for await (const record of paginateMerchants({ fetchPage })) {
      results.push(record);
    }
    expect(results).toEqual(['m1', 'm2']);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('transparently fetches all pages and yields individual records', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ items: ['m1'], nextCursor: 'cursor-1' })
      .mockResolvedValueOnce({ items: ['m2', 'm3'], nextCursor: null });

    const results: string[] = [];
    for await (const record of paginateMerchants({ fetchPage })) {
      results.push(record);
    }

    expect(results).toEqual(['m1', 'm2', 'm3']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, null);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'cursor-1');
  });

  it('yields nothing for an empty result', async () => {
    const fetchPage = jest.fn().mockResolvedValue({ items: [], nextCursor: null });
    const results: string[] = [];
    for await (const record of paginateMerchants({ fetchPage })) {
      results.push(record);
    }
    expect(results).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('propagates a typed LumenFlowError thrown mid-pagination', async () => {
    const error = new LumenFlowError(
      PaymentErrorCode.NetworkError,
      'network failed mid-pagination',
    );
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ items: ['m1'], nextCursor: 'cursor-1' })
      .mockRejectedValueOnce(error);

    const results: string[] = [];
    await expect(
      (async () => {
        for await (const record of paginateMerchants({ fetchPage })) {
          results.push(record);
        }
      })(),
    ).rejects.toBeInstanceOf(LumenFlowError);

    expect(results).toEqual(['m1']);
    expect(fetchPage).toHaveBeenCalledTimes(2);
  });
});
