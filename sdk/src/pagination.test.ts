import { getAllPayments, PaymentPage } from "./pagination";

type TestPayment = { order_id: string };

async function collect<T extends { [field: string]: unknown }>(
  iterator: AsyncIterableIterator<T[]>,
): Promise<T[][]> {
  const pages: T[][] = [];
  for await (const page of iterator) pages.push(page);
  return pages;
}

describe("getAllPayments", () => {
  it("yields a single page", async () => {
    const fetchPage = jest.fn().mockResolvedValue({ payments: [{ order_id: "1" }], next_cursor: null } satisfies PaymentPage<TestPayment>);
    await expect(collect(getAllPayments({ fetchPage }))).resolves.toEqual([[{ order_id: "1" }]]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(null);
  });

  it("follows cursors and yields each page", async () => {
    const pages: Record<string, PaymentPage<TestPayment>> = {
      start: { payments: [{ order_id: "1" }], next_cursor: "next" },
      next: { payments: [{ order_id: "2" }], next_cursor: null },
    };
    const fetchPage = jest.fn((cursor: string | null) => Promise.resolve(pages[cursor ?? "start"]));
    await expect(collect(getAllPayments({ fetchPage }))).resolves.toEqual([[{ order_id: "1" }], [{ order_id: "2" }]]);
    expect(fetchPage.mock.calls.map(([cursor]) => cursor)).toEqual([null, "next"]);
  });

  it("does not fetch remaining pages after an early break", async () => {
    const fetchPage = jest.fn()
      .mockResolvedValueOnce({ payments: [{ order_id: "1" }], next_cursor: "next" })
      .mockResolvedValueOnce({ payments: [{ order_id: "2" }], next_cursor: null });
    for await (const page of getAllPayments({ fetchPage })) {
      expect(page).toEqual([{ order_id: "1" }]);
      break;
    }
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });
});
