import {
  createCsrfToken,
  verifyCsrfToken,
  isSafeMethod,
  csrfMiddleware,
  setCsrfCookie,
} from "../../security/csrfProtection";

const SECRET = "test-secret-at-least-16-chars";

describe("csrfProtection", () => {
  it("accepts a token that matches its double-submit cookie for the session", () => {
    const token = createCsrfToken("session-1", SECRET);
    expect(verifyCsrfToken(token, token, "session-1", SECRET)).toEqual({
      valid: true,
      error: "",
    });
  });

  it("exempts safe methods without a token", () => {
    expect(isSafeMethod("get")).toBe(true);
    expect(
      verifyCsrfToken(undefined, undefined, "s", SECRET, { method: "GET" }).valid
    ).toBe(true);
  });

  it("rejects a missing token on a state-changing request", () => {
    const r = verifyCsrfToken(undefined, "x", "s", SECRET, { method: "POST" });
    expect(r.valid).toBe(false);
    expect(r.error).toContain("missing CSRF token");
  });

  it("rejects a token/cookie mismatch", () => {
    const a = createCsrfToken("s", SECRET);
    const b = createCsrfToken("s", SECRET);
    expect(verifyCsrfToken(a, b, "s", SECRET).valid).toBe(false);
  });

  it("rejects a token bound to a different session", () => {
    const token = createCsrfToken("session-1", SECRET);
    const r = verifyCsrfToken(token, token, "session-2", SECRET);
    expect(r.valid).toBe(false);
    expect(r.error).toContain("signature");
  });

  it("rejects an expired token", () => {
    let clock = 1_000_000;
    const token = createCsrfToken("s", SECRET, {
      ttlSeconds: 1,
      now: () => clock,
    });
    clock += 5_000;
    const r = verifyCsrfToken(token, token, "s", SECRET, { now: () => clock });
    expect(r.error).toContain("expired");
  });
});

interface FakeRequest {
  method: string;
  headers: Record<string, string | undefined>;
  cookies?: Record<string, string>;
}

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status(code: number): FakeResponse;
  json(payload: unknown): FakeResponse;
  setHeader(name: string, value: string): FakeResponse;
}

function makeReq(
  method: string,
  headers: Record<string, string | undefined> = {},
  cookies: Record<string, string> = {}
): FakeRequest {
  return { method, headers, cookies };
}

function makeRes(): FakeResponse {
  const res: FakeResponse = {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    setHeader(name: string, value: string) {
      res.headers[name.toLowerCase()] = value;
      return res;
    },
  };
  return res;
}

function runMiddleware(
  req: FakeRequest,
  res: FakeResponse
): { nextCalled: boolean } {
  let nextCalled = false;
  const next = () => {
    nextCalled = true;
  };
  csrfMiddleware({ secret: SECRET })(req as any, res as any, next);
  return { nextCalled };
}

describe("csrfMiddleware", () => {
  it("rejects a POST without a token or cookie with 403 and does not call next", () => {
    const req = makeReq("POST");
    const res = makeRes();
    const { nextCalled } = runMiddleware(req, res);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("accepts a POST with a valid token in both header and cookie", () => {
    const token = createCsrfToken("session-1", SECRET);
    const req = makeReq(
      "POST",
      { "x-csrf-token": token },
      { csrf_token: token }
    );
    const res = makeRes();
    const { nextCalled } = runMiddleware(req, res);
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("rejects a POST with mismatched header and cookie with 403", () => {
    const headerToken = createCsrfToken("session-1", SECRET);
    const cookieToken = createCsrfToken("session-1", SECRET);
    const req = makeReq(
      "POST",
      { "x-csrf-token": headerToken },
      { csrf_token: cookieToken }
    );
    const res = makeRes();
    const { nextCalled } = runMiddleware(req, res);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("passes a GET through without a token", () => {
    const req = makeReq("GET");
    const res = makeRes();
    const { nextCalled } = runMiddleware(req, res);
    expect(nextCalled).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it("setCsrfCookie emits a Set-Cookie header with SameSite=Strict, Secure and HttpOnly", () => {
    const res = makeRes();
    const token = createCsrfToken("session-1", SECRET);
    setCsrfCookie(res as any, token);
    const cookie = res.headers["set-cookie"];
    expect(cookie).toBeDefined();
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("HttpOnly");
  });
});
