import { LumenFlowError, PaymentErrorCode } from './errors';

export interface PaginatedPage<T> {
  items: T[];
  nextCursor?: string | null;
}

export interface FetchAllPagesOptions<T> {
  fetchPage: (cursor?: string | null) => Promise<PaginatedPage<T>>;
  initialCursor?: string | null;
  maxPages?: number;
}

export interface PaginateOptions {
  initialCursor?: string | null;
  maxPages?: number;
}

export async function fetchAllPages<T>(options: FetchAllPagesOptions<T>): Promise<T[]> {
  const pages: T[] = [];
  let cursor = options.initialCursor ?? null;
  let pageCount = 0;
  const maxPages = options.maxPages ?? 100;

  while (true) {
    if (pageCount >= maxPages) {
      throw new LumenFlowError(PaymentErrorCode.PaginationLimitExceeded, 'Pagination exceeded maximum page count');
    }

    const page = await options.fetchPage(cursor);
    if (!page || !Array.isArray(page.items)) {
      throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'Invalid pagination response: items array is required');
    }

    pages.push(...page.items);
    pageCount += 1;

    if (!page.nextCursor) {
      break;
    }

    if (page.nextCursor === cursor) {
      throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'Pagination returned the same cursor twice');
    }

    cursor = page.nextCursor;
  }

  return pages;
}

export async function fetchAllPayments<T>(fetchPage: (cursor?: string | null) => Promise<PaginatedPage<T>>): Promise<T[]> {
  return fetchAllPages({ fetchPage });
}

/**
 * Async generator that transparently fetches all pages and yields individual
 * records (not pages). Uses the same cursor logic as {@link fetchAllPages}.
 *
 * Errors encountered while fetching a page are surfaced as {@link LumenFlowError}
 * instances so consumers can handle them uniformly.
 */
export async function* paginate<T>(
  fetchPage: (cursor?: string | null) => Promise<PaginatedPage<T>>,
  options: PaginateOptions = {},
): AsyncGenerator<T, void, void> {
  let cursor = options.initialCursor ?? null;
  let pageCount = 0;
  const maxPages = options.maxPages ?? 100;

  while (true) {
    if (pageCount >= maxPages) {
      throw new LumenFlowError(PaymentErrorCode.PaginationLimitExceeded, 'Pagination exceeded maximum page count');
    }

    let page: PaginatedPage<T>;
    try {
      page = await fetchPage(cursor);
    } catch (error: unknown) {
      if (error instanceof LumenFlowError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error while fetching page';
      throw new LumenFlowError(PaymentErrorCode.InvalidInput, `Pagination failed: ${message}`);
    }

    if (!page || !Array.isArray(page.items)) {
      throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'Invalid pagination response: items array is required');
    }

    for (const item of page.items) {
      yield item;
    }

    pageCount += 1;

    if (!page.nextCursor) {
      break;
    }

    if (page.nextCursor === cursor) {
      throw new LumenFlowError(PaymentErrorCode.InvalidInput, 'Pagination returned the same cursor twice');
    }

    cursor = page.nextCursor;
  }
}