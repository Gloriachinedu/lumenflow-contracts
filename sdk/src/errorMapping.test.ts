import { ERROR_TYPES, PaymentErrorCode, errorFromCode } from "./errors";

describe("Soroban contract error mapping", () => {
  it("maps every contract error code to a serializable typed error", () => {
    const codes = Object.values(PaymentErrorCode).filter((value): value is PaymentErrorCode => typeof value === "number");
    expect(Object.keys(ERROR_TYPES).map(Number).sort((a, b) => a - b)).toEqual(codes.sort((a, b) => a - b));
    for (const code of codes) {
      const error = errorFromCode(code, { source: "contract" });
      expect(error.code).toBe(code);
      expect(JSON.parse(JSON.stringify(error))).toEqual(expect.objectContaining({ code, name: error.name, details: { source: "contract" } }));
    }
  });
});