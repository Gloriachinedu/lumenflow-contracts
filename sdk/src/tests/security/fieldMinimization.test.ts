import {
  minimizeMerchantRecord,
  minimizePayerRecord,
} from "../../security/fieldMinimization";

const merchant = {
  id: "m_1",
  displayName: "Acme",
  logoUrl: "https://x/y.png",
  country: "DE",
  email: "owner@acme.example",
  walletAddress: "GABC1234567890XYZ",
  taxId: "DE123456789",
  createdAt: "2026-01-01",
};

describe("minimizeMerchantRecord", () => {
  it("exposes only public fields to a public audience", () => {
    expect(minimizeMerchantRecord(merchant, "public")).toEqual({
      id: "m_1",
      displayName: "Acme",
      logoUrl: "https://x/y.png",
      country: "DE",
    });
  });

  it("masks identifier fields for a partner audience and drops unknown fields", () => {
    const out = minimizeMerchantRecord(merchant, "partner");
    expect(out.taxId).toBeUndefined();
    expect(out.email).toBe("ow***@acme.example");
    expect(String(out.walletAddress)).toMatch(/^GA\*+0XYZ$/);
  });

  it("returns the full record for internal use", () => {
    expect(minimizeMerchantRecord(merchant, "internal")).toEqual(merchant);
  });

  it("can opt out of masking", () => {
    const out = minimizeMerchantRecord(merchant, "partner", {
      maskIdentifiers: false,
    });
    expect(out.email).toBe("owner@acme.example");
  });

  it("throws on an unknown audience or non-object record", () => {
    // @ts-expect-error invalid audience
    expect(() => minimizeMerchantRecord(merchant, "nope")).toThrow();
    // @ts-expect-error invalid record
    expect(() => minimizeMerchantRecord(null, "public")).toThrow();
  });
});

describe("minimizePayerRecord", () => {
  it("exposes only the id publicly", () => {
    expect(
      minimizePayerRecord(
        { id: "p_1", email: "a@b.example", walletAddress: "GXYZ" },
        "public"
      )
    ).toEqual({ id: "p_1" });
  });
});
