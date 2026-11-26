import {
  ERROR_TYPES,
  PaymentErrorCode,
  errorFromCode,
  LumenFlowError,
  RateLimitError,
  SignatureError,
  NotFoundError,
  NetworkError,
} from "./errors";

describe("Soroban contract error mapping", () => {
  it("maps every contract error code to a serializable typed error", () => {
    const codes = Object.values(PaymentErrorCode).filter((value): value is PaymentErrorCode => typeof value === "number");
    expect(Object.keys(ERROR_TYPES).map(Number).sort((a, b) => a - b)).toEqual(codes.sort((a, b) => a - b));
    for (const code of codes) {
      const error = errorFromCode(code, { source: "contract" });
      expect(error.code).toBe(code);
      expect(JSON.parse(JSON.stringify(error))).toEqual(
        expect.objectContaining({
          code,
          name: error.name,
          retryable: error.retryable,
          details: { source: "contract" },
        })
      );
    }
  });
});

describe("LumenFlowError base class", () => {
  it("exposes code, message, and retryable", () => {
    const error = new LumenFlowError(1000, "base error");
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(LumenFlowError);
    expect(error.code).toBe(1000);
    expect(error.message).toBe("base error");
    expect(typeof error.retryable).toBe("boolean");
  });

  it("defaults retryable to false", () => {
    const error = new LumenFlowError(1000, "base error");
    expect(error.retryable).toBe(false);
  });

  it("serializes code, message, and retryable", () => {
    const error = new LumenFlowError(1000, "base error", true);
    const serialized = JSON.parse(JSON.stringify(error));
    expect(serialized).toEqual(
      expect.objectContaining({ code: 1000, message: "base error", retryable: true })
    );
  });
});

describe("Structured error subclasses", () => {
  it("RateLimitError is a LumenFlowError and is retryable", () => {
    const error = new RateLimitError("too many requests");
    expect(error).toBeInstanceOf(LumenFlowError);
    expect(error).toBeInstanceOf(RateLimitError);
    expect(error.retryable).toBe(true);
    expect(typeof error.code).toBe("number");
    expect(error.message).toBe("too many requests");
  });

  it("NetworkError is a LumenFlowError and is retryable", () => {
    const error = new NetworkError("connection failed");
    expect(error).toBeInstanceOf(LumenFlowError);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error.retryable).toBe(true);
    expect(typeof error.code).toBe("number");
    expect(error.message).toBe("connection failed");
  });

  it("SignatureError is a LumenFlowError and is not retryable", () => {
    const error = new SignatureError("invalid signature");
    expect(error).toBeInstanceOf(LumenFlowError);
    expect(error).toBeInstanceOf(SignatureError);
    expect(error.retryable).toBe(false);
    expect(typeof error.code).toBe("number");
    expect(error.message).toBe("invalid signature");
  });

  it("NotFoundError is a LumenFlowError and is not retryable", () => {
    const error = new NotFoundError("resource not found");
    expect(error).toBeInstanceOf(LumenFlowError);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.retryable).toBe(false);
    expect(typeof error.code).toBe("number");
    expect(error.message).toBe("resource not found");
  });

  it("serialization round-trips include retryable", () => {
    const errors = [
      new RateLimitError("rate limited"),
      new NetworkError("network down"),
      new SignatureError("bad signature"),
      new NotFoundError("missing"),
    ];
    for (const error of errors) {
      const serialized = JSON.parse(JSON.stringify(error));
      expect(serialized).toEqual(
        expect.objectContaining({
          code: error.code,
          message: error.message,
          retryable: error.retryable,
        })
      );
    }
  });
});

describe("errorFromCode returns correct subclass", () => {
  it("returns a LumenFlowError instance for every contract code", () => {
    const codes = Object.values(PaymentErrorCode).filter(
      (value): value is PaymentErrorCode => typeof value === "number"
    );
    for (const code of codes) {
      const error = errorFromCode(code, { source: "contract" });
      expect(error).toBeInstanceOf(LumenFlowError);
      expect(typeof error.retryable).toBe("boolean");
    }
  });

  it("returns the expected subclass for representative contract codes", () => {
    const codes = Object.values(PaymentErrorCode).filter(
      (value): value is PaymentErrorCode => typeof value === "number"
    );
    for (const code of codes) {
      const error = errorFromCode(code, { source: "contract" });
      const expectedClass = ERROR_TYPES[code];
      if (expectedClass) {
        expect(error).toBeInstanceOf(expectedClass);
      }
    }
  });
});