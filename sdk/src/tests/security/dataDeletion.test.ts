import { authorizeDeletionRequest } from "../../security/dataDeletion";

describe("authorizeDeletionRequest", () => {
  it("allows a subject to delete their own record", () => {
    expect(
      authorizeDeletionRequest({ requester: "wallet-A", subject: "wallet-A" })
    ).toEqual({ outcome: "allow", reason: "" });
  });

  it("denies an unauthenticated request", () => {
    const r = authorizeDeletionRequest({ requester: "", subject: "wallet-A" });
    expect(r.outcome).toBe("deny");
    expect(r.reason).toContain("not authenticated");
  });

  it("denies deleting someone else's record without privilege", () => {
    const r = authorizeDeletionRequest({
      requester: "wallet-A",
      subject: "wallet-B",
    });
    expect(r.outcome).toBe("deny");
  });

  it("requires a legal basis for admin deletions", () => {
    const r = authorizeDeletionRequest({
      requester: "ops-1",
      subject: "wallet-B",
      role: "admin",
    });
    expect(r.outcome).toBe("deny");
    expect(r.reason).toContain("legalBasis");
  });

  it("allows a compliance deletion with a documented basis", () => {
    expect(
      authorizeDeletionRequest({
        requester: "ops-1",
        subject: "wallet-B",
        role: "compliance",
        legalBasis: "GDPR Art.17 erasure request #42",
      }).outcome
    ).toBe("allow");
  });

  it("denies erasure while a legal hold or unsettled obligation exists", () => {
    expect(
      authorizeDeletionRequest({
        requester: "wallet-A",
        subject: "wallet-A",
        legalHold: true,
      }).outcome
    ).toBe("deny");
    expect(
      authorizeDeletionRequest({
        requester: "wallet-A",
        subject: "wallet-A",
        hasUnsettledObligations: true,
      }).outcome
    ).toBe("deny");
  });

  it("treats an already-deleted record as a no-op", () => {
    expect(
      authorizeDeletionRequest({
        requester: "wallet-A",
        subject: "wallet-A",
        alreadyDeleted: true,
      }).outcome
    ).toBe("noop");
  });
});
