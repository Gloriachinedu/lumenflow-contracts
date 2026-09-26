import {
  REDACTED,
  redactString,
  redactSecrets,
  redactingLogger,
} from "../../security/logRedaction";

const STELLAR_SECRET = "SA" + "B".repeat(54);

describe("redactString", () => {
  it("redacts a Stellar secret key", () => {
    expect(redactString(`account=${STELLAR_SECRET} done`)).toBe(
      `account=${REDACTED} done`
    );
  });

  it("redacts a bearer authorization header but keeps the scheme", () => {
    expect(redactString("Authorization: Bearer abcdef123456ghijkl")).toBe(
      `Authorization: Bearer ${REDACTED}`
    );
  });

  it("redacts a PEM private key block", () => {
    const pem =
      "-----BEGIN PRIVATE KEY-----\nMIIBVprivatekeymaterial\n-----END PRIVATE KEY-----";
    expect(redactString(`key: ${pem}`)).toBe(`key: ${REDACTED}`);
  });

  it("redacts secret-looking assignments while keeping the field name", () => {
    expect(redactString("api_key=supersecretvalue123")).toBe(
      `api_key=${REDACTED}`
    );
  });

  it("leaves ordinary text untouched", () => {
    expect(redactString("payment 42 completed for merchant m_1")).toBe(
      "payment 42 completed for merchant m_1"
    );
  });
});

describe("redactSecrets", () => {
  it("replaces values under known secret keys wholesale", () => {
    const input = {
      merchantId: "m_1",
      authorization: "Bearer xyz",
      nested: { password: "hunter2", note: "ok" },
    };
    expect(redactSecrets(input)).toEqual({
      merchantId: "m_1",
      authorization: REDACTED,
      nested: { password: REDACTED, note: "ok" },
    });
  });

  it("scrubs secrets embedded in string values and arrays", () => {
    const out = redactSecrets({ logs: [`seed ${STELLAR_SECRET}`] });
    expect(out.logs[0]).toBe(`seed ${REDACTED}`);
  });

  it("does not mutate the input", () => {
    const input = { password: "p" };
    redactSecrets(input);
    expect(input.password).toBe("p");
  });

  it("handles circular references", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => redactSecrets(a)).not.toThrow();
  });

  it("redacts the string form of Error objects", () => {
    const out = redactSecrets(new Error(`failed with ${STELLAR_SECRET}`));
    expect(String(out)).toContain(REDACTED);
  });
});

describe("redactingLogger", () => {
  it("redacts every argument before passing them to the sink", () => {
    const calls: unknown[][] = [];
    const log = redactingLogger((...args: unknown[]) => calls.push(args));
    log("payment failed", { authorization: "Bearer secret" });
    expect(calls[0]).toEqual([
      "payment failed",
      { authorization: REDACTED },
    ]);
  });
});
