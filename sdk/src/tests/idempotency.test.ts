import { withIdempotency } from "../idempotency";
import { LumenFlowError, PaymentErrorCode } from "../errors";

describe("withIdempotency", () => {
  test("returns result with duplicate=false on first successful call", async () => {
    const invoke = jest.fn().mockResolvedValue("ok");
    const { result, duplicate } = await withIdempotency(invoke);
    expect(result).toBe("ok");
    expect(duplicate).toBe(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test("calls fallback and returns duplicate=true on PaymentAlreadyExists", async () => {
    const existing = { orderId: "ORDER_001", amount: BigInt(1000) };
    const invoke = jest
      .fn()
      .mockRejectedValue(new LumenFlowError(PaymentErrorCode.PaymentAlreadyExists));
    const fallback = jest.fn().mockResolvedValue(existing);

    const { result, duplicate } = await withIdempotency(invoke, fallback);
    expect(result).toEqual(existing);
    expect(duplicate).toBe(true);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  test("re-throws PaymentAlreadyExists when no fallback is provided", async () => {
    const invoke = jest
      .fn()
      .mockRejectedValue(new LumenFlowError(PaymentErrorCode.PaymentAlreadyExists));

    await expect(withIdempotency(invoke)).rejects.toBeInstanceOf(LumenFlowError);
  });

  test("re-throws unrelated errors regardless of fallback", async () => {
    const unrelated = new LumenFlowError(PaymentErrorCode.InvalidSignature);
    const invoke = jest.fn().mockRejectedValue(unrelated);
    const fallback = jest.fn();

    await expect(withIdempotency(invoke, fallback)).rejects.toBe(unrelated);
    expect(fallback).not.toHaveBeenCalled();
  });

  test("re-throws generic errors", async () => {
    const invoke = jest.fn().mockRejectedValue(new Error("network failure"));
    await expect(withIdempotency(invoke)).rejects.toThrow("network failure");
  });
});
