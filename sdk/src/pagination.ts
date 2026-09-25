export interface Payment {
  [field: string]: unknown;
}

export interface PaymentPage<TPayment extends Payment = Payment> {
  payments: TPayment[];
  next_cursor: string | null;
}

export interface GetAllPaymentsOptions<TPayment extends Payment = Payment> {
  fetchPage: (cursor: string | null) => Promise<PaymentPage<TPayment>>;
  cursor?: string | null;
}

export async function* getAllPayments<TPayment extends Payment = Payment>(
  options: GetAllPaymentsOptions<TPayment>,
): AsyncIterableIterator<TPayment[]> {
  let cursor = options.cursor ?? null;

  while (true) {
    const page = await options.fetchPage(cursor);
    yield page.payments;

    if (page.next_cursor === null) {
      return;
    }
    cursor = page.next_cursor;
  }
}
