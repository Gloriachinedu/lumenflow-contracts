import { AbuseDetector } from "../../security/abuseDetection";

describe("AbuseDetector", () => {
  let clock: number;
  const now = () => clock;

  beforeEach(() => {
    clock = 0;
  });

  const hit = (d: AbuseDetector, over: Partial<{ source: string; target: string; failed: boolean }> = {}) =>
    d.record({ source: "s1", target: "link-1", failed: false, ...over });

  it("returns ok for low-volume traffic", () => {
    const d = new AbuseDetector({ now });
    for (let i = 0; i < 5; i++) hit(d);
    expect(d.verdict("s1").severity).toBe("ok");
  });

  it("flags a request burst as suspicious then abusive", () => {
    const d = new AbuseDetector({
      suspiciousCount: 10,
      abusiveCount: 20,
      now,
    });
    let last;
    for (let i = 0; i < 12; i++) last = hit(d);
    expect(last!.severity).toBe("suspicious");
    for (let i = 0; i < 10; i++) last = hit(d);
    expect(last!.severity).toBe("abusive");
  });

  it("flags a high failure ratio as abusive (card testing / probing)", () => {
    const d = new AbuseDetector({
      minSampleForRatio: 10,
      failureRatio: 0.7,
      suspiciousCount: 100,
      abusiveCount: 100,
      now,
    });
    let last;
    for (let i = 0; i < 12; i++) last = hit(d, { failed: true });
    expect(last!.severity).toBe("abusive");
    expect(last!.reason).toContain("failure rate");
  });

  it("flags enumeration across many distinct targets", () => {
    const d = new AbuseDetector({
      distinctTargets: 5,
      suspiciousCount: 100,
      abusiveCount: 100,
      now,
    });
    let last;
    for (let i = 0; i < 6; i++) last = hit(d, { target: `link-${i}` });
    expect(last!.severity).toBe("abusive");
    expect(last!.reason).toContain("distinct targets");
  });

  it("resets the verdict once the burst window rolls over", () => {
    const d = new AbuseDetector({ windowMs: 10_000, suspiciousCount: 3, abusiveCount: 5, now });
    for (let i = 0; i < 4; i++) hit(d);
    expect(d.verdict("s1").severity).toBe("suspicious");
    clock += 10_001;
    expect(d.verdict("s1").severity).toBe("ok");
  });

  it("tracks sources independently", () => {
    const d = new AbuseDetector({ abusiveCount: 3, suspiciousCount: 3, now });
    for (let i = 0; i < 4; i++) hit(d, { source: "attacker" });
    expect(d.verdict("attacker").severity).toBe("abusive");
    expect(d.verdict("normal").severity).toBe("ok");
  });
});
