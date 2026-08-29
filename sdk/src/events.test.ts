/**
 * @file events.test.ts
 *
 * Tests for event payload schema validation (issue #834).
 *
 * Each test verifies that:
 *   1. A correctly-shaped payload passes `validateEventPayload` and returns the
 *      expected narrowed type.
 *   2. A payload missing a required field throws a descriptive error.
 *
 * The field names and types in the "happy path" fixtures are kept in sync with
 * the `#[contracttype]` structs defined in
 * `contracts/lumenflow/src/types.rs`.
 */

import {
  validateEventPayload,
  PaymentStatus,
  PaymentProcessedEvent,
  RefundInitiatedEvent,
  RefundApprovedEvent,
  RefundRejectedEvent,
  RefundExecutedEvent,
  MultisigInitiatedEvent,
  MultisigExecutedEvent,
  PaymentRequestPaidEvent,
  PaymentStatusUpdatedEvent,
} from "./events";

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADDR_A = "GABC123";
const ADDR_B = "GDEF456";
const ADDR_TOKEN = "GTOKEN789";

// ── payment_processed ─────────────────────────────────────────────────────────

describe("payment_processed", () => {
  const valid: PaymentProcessedEvent = {
    order_id: "ORDER_001",
    payer: ADDR_A,
    merchant: ADDR_B,
    amount: 1_000n,
  };

  test("accepts a valid payload", () => {
    const evt = validateEventPayload("payment_processed", valid);
    expect(evt.name).toBe("payment_processed");
    expect((evt.data as PaymentProcessedEvent).order_id).toBe("ORDER_001");
    expect((evt.data as PaymentProcessedEvent).amount).toBe(1_000n);
  });

  test.each(["order_id", "payer", "merchant", "amount"])(
    "rejects payload missing field %s",
    (field) => {
      const bad = { ...valid, [field]: undefined };
      expect(() => validateEventPayload("payment_processed", bad)).toThrow(field);
    }
  );
});

// ── refund_initiated ──────────────────────────────────────────────────────────

describe("refund_initiated", () => {
  const valid: RefundInitiatedEvent = {
    refund_id: "RF_001",
    order_id: "ORDER_001",
    initiator: ADDR_A,
    amount: 200n,
  };

  test("accepts a valid payload", () => {
    const evt = validateEventPayload("refund_initiated", valid);
    expect(evt.name).toBe("refund_initiated");
    expect((evt.data as RefundInitiatedEvent).refund_id).toBe("RF_001");
  });

  test.each(["refund_id", "order_id", "initiator", "amount"])(
    "rejects payload missing field %s",
    (field) => {
      const bad = { ...valid, [field]: undefined };
      expect(() => validateEventPayload("refund_initiated", bad)).toThrow(field);
    }
  );
});

// ── refund_approved ───────────────────────────────────────────────────────────

describe("refund_approved", () => {
  const valid: RefundApprovedEvent = {
    refund_id: "RF_002",
    order_id: "ORDER_002",
    merchant: ADDR_B,
    amount: 300n,
  };

  test("accepts a valid payload", () => {
    const evt = validateEventPayload("refund_approved", valid);
    expect(evt.name).toBe("refund_approved");
    expect((evt.data as RefundApprovedEvent).merchant).toBe(ADDR_B);
  });

  test.each(["refund_id", "order_id", "merchant", "amount"])(
    "rejects payload missing field %s",
    (field) => {
      const bad = { ...valid, [field]: undefined };
      expect(() => validateEventPayload("refund_approved", bad)).toThrow(field);
    }
  );
});

// ── refund_rejected ───────────────────────────────────────────────────────────

describe("refund_rejected", () => {
  const valid: RefundRejectedEvent = {
    refund_id: "RF_003",
    order_id: "ORDER_003",
    merchant: ADDR_B,
    amount: 100n,
  };

  test("accepts a valid payload", () => {
    const evt = validateEventPayload("refund_rejected", valid);
    expect(evt.name).toBe("refund_rejected");
  });

  test.each(["refund_id", "order_id", "merchant", "amount"])(
    "rejects payload missing field %s",
    (field) => {
      const bad = { ...valid, [field]: undefined };
      expect(() => validateEventPayload("refund_rejected", bad)).toThrow(field);
    }
  );
});

// ── refund_executed ───────────────────────────────────────────────────────────

describe("refund_executed", () => {
  const valid: RefundExecutedEvent = {
    refund_id: "RF_004",
    order_id: "ORDER_004",
    payer: ADDR_A,
    merchant: ADDR_B,
    amount: 400n,
    token: ADDR_TOKEN,
  };

  test("accepts a valid payload", () => {
    const evt = validateEventPayload("refund_executed", valid);
    expect(evt.name).toBe("refund_executed");
    expect((evt.data as RefundExecutedEvent).token).toBe(ADDR_TOKEN);
  });

  test.each(["refund_id", "order_id", "payer", "merchant", "amount", "token"])(
    "rejects payload missing field %s",
    (field) => {
      const bad = { ...valid, [field]: undefined };
      expect(() => validateEventPayload("refund_executed", bad)).toThrow(field);
    }
  );
});

// ── multisig_initiated ────────────────────────────────────────────────────────

describe("multisig_initiated", () => {
  const valid: MultisigInitiatedEvent = {
    payment_id: "MS_001",
    merchant: ADDR_B,
    token: ADDR_TOKEN,
    amount: 5_000n,
    required_signatures: 2,
  };

  test("accepts a valid payload", () => {
    const evt = validateEventPayload("multisig_initiated", valid);
    expect(evt.name).toBe("multisig_initiated");
    expect((evt.data as MultisigInitiatedEvent).required_signatures).toBe(2);
  });

  test.each(["payment_id", "merchant", "token", "amount", "required_signatures"])(
    "rejects payload missing field %s",
    (field) => {
      const bad = { ...valid, [field]: undefined };
      expect(() => validateEventPayload("multisig_initiated", bad)).toThrow(field);
    }
  );
});

// ── multisig_executed ─────────────────────────────────────────────────────────

describe("multisig_executed", () => {
  const valid: MultisigExecutedEvent = {
    payment_id: "MS_002",
    payer: ADDR_A,
    merchant: ADDR_B,
    token: ADDR_TOKEN,
    amount: 5_000n,
  };

  test("accepts a valid payload", () => {
    const evt = validateEventPayload("multisig_executed", valid);
    expect(evt.name).toBe("multisig_executed");
  });

  test.each(["payment_id", "payer", "merchant", "token", "amount"])(
    "rejects payload missing field %s",
    (field) => {
      const bad = { ...valid, [field]: undefined };
      expect(() => validateEventPayload("multisig_executed", bad)).toThrow(field);
    }
  );
});

// ── payment_request_paid ──────────────────────────────────────────────────────

describe("payment_request_paid", () => {
  const valid: PaymentRequestPaidEvent = {
    request_id: "REQ_001",
    payer: ADDR_A,
    merchant: ADDR_B,
    token: ADDR_TOKEN,
    amount: 750n,
  };

  test("accepts a valid payload", () => {
    const evt = validateEventPayload("payment_request_paid", valid);
    expect(evt.name).toBe("payment_request_paid");
    expect((evt.data as PaymentRequestPaidEvent).request_id).toBe("REQ_001");
  });

  test.each(["request_id", "payer", "merchant", "token", "amount"])(
    "rejects payload missing field %s",
    (field) => {
      const bad = { ...valid, [field]: undefined };
      expect(() => validateEventPayload("payment_request_paid", bad)).toThrow(field);
    }
  );
});

// ── payment_status_updated ────────────────────────────────────────────────────

describe("payment_status_updated", () => {
  const valid: PaymentStatusUpdatedEvent = {
    order_id: "ORDER_STAT",
    status: PaymentStatus.PartiallyRefunded,
    refunded_amount: 500n,
    original_amount: 1_000n,
  };

  test("accepts a valid payload", () => {
    const evt = validateEventPayload("payment_status_updated", valid);
    expect(evt.name).toBe("payment_status_updated");
    expect((evt.data as PaymentStatusUpdatedEvent).status).toBe(PaymentStatus.PartiallyRefunded);
  });

  test.each(["order_id", "status", "refunded_amount", "original_amount"])(
    "rejects payload missing field %s",
    (field) => {
      const bad = { ...valid, [field]: undefined };
      expect(() => validateEventPayload("payment_status_updated", bad)).toThrow(field);
    }
  );
});

// ── unknown event ─────────────────────────────────────────────────────────────

describe("unknown event", () => {
  test("throws for an unrecognised event name", () => {
    expect(() => validateEventPayload("totally_unknown", {})).toThrow("unknown event name");
  });

  test("throws when payload is not an object", () => {
    expect(() => validateEventPayload("payment_processed", "not-an-object")).toThrow(
      "expected an object payload"
    );
  });

  test("throws when payload is null", () => {
    expect(() => validateEventPayload("payment_processed", null)).toThrow(
      "expected an object payload"
    );
  });
});
