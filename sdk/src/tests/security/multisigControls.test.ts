import {
  validateQuorumConfig,
  validateSignerReplacement,
} from "../../security/multisigControls";

describe("validateQuorumConfig", () => {
  it("accepts a well-formed 2-of-3 configuration", () => {
    expect(
      validateQuorumConfig({ signers: ["A", "B", "C"], requiredSignatures: 2 })
    ).toEqual({ valid: true, error: "" });
  });

  it("rejects a quorum below 2", () => {
    const r = validateQuorumConfig({ signers: ["A", "B"], requiredSignatures: 1 });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("at least 2");
  });

  it("rejects a quorum larger than the signer count (un-meetable)", () => {
    const r = validateQuorumConfig({ signers: ["A", "B"], requiredSignatures: 3 });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("exceeds");
  });

  it("rejects duplicate signers", () => {
    const r = validateQuorumConfig({ signers: ["A", "A", "B"], requiredSignatures: 2 });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("duplicate");
  });

  it("rejects empty signer entries", () => {
    const r = validateQuorumConfig({ signers: ["A", "  "], requiredSignatures: 2 });
    expect(r.valid).toBe(false);
  });
});

describe("validateSignerReplacement", () => {
  const base = {
    currentSigners: ["A", "B", "C"],
    requiredSignatures: 2,
    outgoing: "C",
    incoming: "D",
  };

  it("accepts a clean 1:1 replacement", () => {
    expect(validateSignerReplacement(base)).toEqual({ valid: true, error: "" });
  });

  it("rejects replacing a signer that is not in the set", () => {
    const r = validateSignerReplacement({ ...base, outgoing: "Z" });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("not in the current set");
  });

  it("rejects an incoming signer that already exists (duplicate)", () => {
    const r = validateSignerReplacement({ ...base, incoming: "B" });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("already in the set");
  });

  it("rejects replacement on an executed payment", () => {
    const r = validateSignerReplacement({ ...base, executed: true });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("executed");
  });

  it("rejects when removing the signer drops valid signatures below quorum", () => {
    const r = validateSignerReplacement({
      ...base,
      signedBy: ["C"], // only the outgoing signer has approved
    });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("below the required quorum");
  });

  it("allows replacement when quorum is still met by remaining signers", () => {
    const r = validateSignerReplacement({
      ...base,
      signedBy: ["A", "B", "C"],
    });
    expect(r.valid).toBe(true);
  });
});
