import { buildSignaturePayload, buildSignaturePayloadString } from "./signature";

const BASE = {
  orderId: "ORDER_001",
  merchantAddress: "GABC123",
  payerAddress: "GPAY456",
  tokenAddress: "GTOK789",
  amount: 1000n,
};

describe("buildSignaturePayload", () => {
  it("returns a Uint8Array", () => {
    expect(buildSignaturePayload(BASE)).toBeInstanceOf(Uint8Array);
  });

  it("encodes the canonical colon-delimited format", () => {
    const bytes = buildSignaturePayload(BASE);
    const decoded = new TextDecoder().decode(bytes);
    expect(decoded).toBe("ORDER_001:GABC123:GPAY456:GTOK789:1000");
  });

  it("includes all five fields in the correct positions", () => {
    const decoded = buildSignaturePayloadString(BASE);
    const parts = decoded.split(":");
    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe(BASE.orderId);
    expect(parts[1]).toBe(BASE.merchantAddress);
    expect(parts[2]).toBe(BASE.payerAddress);
    expect(parts[3]).toBe(BASE.tokenAddress);
    expect(parts[4]).toBe(BASE.amount.toString());
  });

  it("handles large i128-range amounts without precision loss", () => {
    const large = { ...BASE, amount: 170141183460469231731687303715884105727n };
    const decoded = buildSignaturePayloadString(large);
    expect(decoded).toContain("170141183460469231731687303715884105727");
  });

  it("produces distinct payloads for different order IDs", () => {
    const a = buildSignaturePayloadString(BASE);
    const b = buildSignaturePayloadString({ ...BASE, orderId: "ORDER_002" });
    expect(a).not.toBe(b);
  });

  it("throws when orderId is empty", () => {
    expect(() => buildSignaturePayload({ ...BASE, orderId: "" })).toThrow();
  });

  it("throws when amount is zero", () => {
    expect(() => buildSignaturePayload({ ...BASE, amount: 0n })).toThrow();
  });

  it("throws when amount is negative", () => {
    expect(() => buildSignaturePayload({ ...BASE, amount: -1n })).toThrow();
  });
});
