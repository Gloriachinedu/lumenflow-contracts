import {
  authorizeDeletionRequest,
  createErasureRequest,
  executeErasure,
  ERASURE_DEADLINE_DAYS,
  OFF_CHAIN_PAYER_DATA_CATEGORIES,
  ON_CHAIN_PAYER_DATA_CATEGORIES,
} from "../../security/dataDeletion";

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

describe("erasure workflow", () => {
  const requestedAt = new Date("2024-01-01T00:00:00.000Z");

  it("creates a pending erasure with a deadline 30 days after requestedAt", () => {
    const request = createErasureRequest({
      requestId: "req-1",
      requester: "wallet-A",
      subject: "wallet-A",
      requestedAt,
    });

    expect(request.status).toBe("pending");
    expect(request.requestId).toBe("req-1");
    expect(request.subject).toBe("wallet-A");
    expect(ERASURE_DEADLINE_DAYS).toBe(30);
    expect(request.deadline.toISOString()).toBe("2024-01-31T00:00:00.000Z");
    expect(
      request.deadline.getTime() - request.requestedAt.getTime()
    ).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("deletes all off-chain payer data categories and returns an audit entry", () => {
    const request = createErasureRequest({
      requestId: "req-2",
      requester: "wallet-A",
      subject: "wallet-A",
      requestedAt,
    });

    const result = executeErasure({
      request,
      now: new Date("2024-01-15T00:00:00.000Z"),
    });

    expect(result.outcome).toBe("completed");
    expect(result.deletedCategories).toEqual(
      expect.arrayContaining([...OFF_CHAIN_PAYER_DATA_CATEGORIES])
    );
    expect(result.deletedCategories).toHaveLength(
      OFF_CHAIN_PAYER_DATA_CATEGORIES.length
    );

    const entry = result.auditEntry;
    expect(entry.requestId).toBe("req-2");
    expect(entry.subject).toBe("wallet-A");
    expect(entry.categories).toEqual(result.deletedCategories);
    expect(entry.completedAt.toISOString()).toBe(
      "2024-01-15T00:00:00.000Z"
    );
  });

  it("excludes on-chain data (nonces, payer index) from deletion and audit", () => {
    const request = createErasureRequest({
      requestId: "req-3",
      requester: "wallet-A",
      subject: "wallet-A",
      requestedAt,
    });

    const result = executeErasure({
      request,
      now: new Date("2024-01-10T00:00:00.000Z"),
    });

    expect(ON_CHAIN_PAYER_DATA_CATEGORIES).toEqual(
      expect.arrayContaining(["nonces", "payerIndex"])
    );
    for (const category of ON_CHAIN_PAYER_DATA_CATEGORIES) {
      expect(result.deletedCategories).not.toContain(category);
      expect(result.auditEntry.categories).not.toContain(category);
    }
    expect(result.retainedOnChainCategories).toEqual(
      expect.arrayContaining([...ON_CHAIN_PAYER_DATA_CATEGORIES])
    );
  });

  it("rejects execution after the 30-day deadline", () => {
    const request = createErasureRequest({
      requestId: "req-4",
      requester: "wallet-A",
      subject: "wallet-A",
      requestedAt,
    });

    const result = executeErasure({
      request,
      now: new Date("2024-02-01T00:00:00.000Z"),
    });

    expect(result.outcome).toBe("rejected");
    expect(result.reason).toContain("deadline");
    expect(result.deletedCategories).toEqual([]);
    expect(result.auditEntry).toBeUndefined();
  });

  it("denies unauthorized erasure requests via the authorization rules", () => {
    const request = createErasureRequest({
      requestId: "req-5",
      requester: "wallet-A",
      subject: "wallet-B",
      requestedAt,
    });

    const result = executeErasure({
      request,
      now: new Date("2024-01-05T00:00:00.000Z"),
    });

    expect(result.outcome).toBe("rejected");
    expect(result.deletedCategories).toEqual([]);
    expect(result.auditEntry).toBeUndefined();
  });
});
