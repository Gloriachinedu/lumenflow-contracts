/**
 * LumenFlow Mock Contract Server
 *
 * A lightweight Node.js HTTP server that mimics the LumenFlow Soroban
 * contract RPC responses for E2E testing.  It maintains in-memory state
 * that can be seeded and reset via helper endpoints.
 *
 * Port: process.env.PORT (default 8080)
 */

const http = require("http");

const PORT = parseInt(process.env.PORT || "8080", 10);

// ── In-memory state ───────────────────────────────────────────────────────────

let state = {
  /** @type {Map<string, object>} orderId → payment */
  payments: new Map(),
  /** @type {Map<string, object>} address → merchant */
  merchants: new Map(),
  /** @type {Map<string, object>} refundId → refund */
  refunds: new Map(),
};

function resetState() {
  state.payments = new Map();
  state.merchants = new Map();
  state.refunds = new Map();
}

// ── HTTP utilities ────────────────────────────────────────────────────────────

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
    "Access-Control-Allow-Origin": "*",
  });
  res.end(payload);
}

function notFound(res) {
  json(res, 404, { error: "Not found" });
}

function badRequest(res, message) {
  json(res, 400, { error: "BadRequest", message });
}

// ── Route handlers ────────────────────────────────────────────────────────────

const routes = {
  // Health check
  "GET /health": (_req, res) => json(res, 200, { ok: true }),

  // ── Seed endpoints ──────────────────────────────────────────────────────────
  "POST /mock/reset": (_req, res) => {
    resetState();
    json(res, 200, { ok: true });
  },

  "POST /mock/seed/payment": async (req, res) => {
    const body = await readBody(req);
    if (!body.order_id) return badRequest(res, "order_id required");
    state.payments.set(body.order_id, { ...body, refunds: body.refunds || [] });
    json(res, 201, { ok: true });
  },

  "POST /mock/seed/merchant": async (req, res) => {
    const body = await readBody(req);
    if (!body.address) return badRequest(res, "address required");
    state.merchants.set(body.address, body);
    json(res, 201, { ok: true });
  },

  "POST /mock/seed/refund": async (req, res) => {
    const body = await readBody(req);
    if (!body.refund_id) return badRequest(res, "refund_id required");
    state.refunds.set(body.refund_id, body);
    // Also attach to the payment
    const payment = state.payments.get(body.order_id);
    if (payment) {
      payment.refunds = payment.refunds || [];
      payment.refunds.push(body);
    }
    json(res, 201, { ok: true });
  },

  // ── Contract simulation endpoints ───────────────────────────────────────────

  "POST /mock/contract/initiate_refund": async (req, res) => {
    const body = await readBody(req);
    const { refund_id, order_id, amount, reason, caller } = body;

    if (!refund_id || !order_id || !amount || !reason || !caller) {
      return badRequest(res, "refund_id, order_id, amount, reason, caller required");
    }

    const payment = state.payments.get(order_id);
    if (!payment) {
      return json(res, 400, {
        error: "ContractError",
        code: "PaymentNotFound",
        message: `No payment found for order_id: ${order_id}`,
      });
    }

    // Check refund window (30 days)
    const thirtyDays = 30 * 24 * 60 * 60;
    if (Date.now() / 1000 - payment.paid_at > thirtyDays) {
      return json(res, 400, {
        error: "ContractError",
        code: "RefundWindowExpired",
        message: "Refund window has expired for this order.",
      });
    }

    // Check amount
    const alreadyRefunded = (payment.refunds || [])
      .filter((r) => r.status === "Executed")
      .reduce((sum, r) => sum + r.amount, 0);

    if (alreadyRefunded + amount > payment.amount) {
      return json(res, 400, {
        error: "ContractError",
        code: "RefundExceedsOriginal",
        message: "Total refunds would exceed the original payment amount.",
      });
    }

    const refund = {
      refund_id,
      order_id,
      amount,
      reason,
      status: "Pending",
      initiator: caller,
    };

    state.refunds.set(refund_id, refund);
    payment.refunds = payment.refunds || [];
    payment.refunds.push(refund);

    json(res, 200, { ok: true, refund_id });
  },

  "POST /mock/contract/approve_refund": async (req, res) => {
    const body = await readBody(req);
    const { refund_id, caller } = body;

    if (!refund_id || !caller) {
      return badRequest(res, "refund_id and caller required");
    }

    const refund = state.refunds.get(refund_id);
    if (!refund) {
      return json(res, 400, {
        error: "ContractError",
        code: "RefundNotFound",
        message: `No refund found for refund_id: ${refund_id}`,
      });
    }

    if (refund.status !== "Pending") {
      return json(res, 400, {
        error: "ContractError",
        code: "InvalidRefundState",
        message: `Refund is in state ${refund.status}, expected Pending`,
      });
    }

    refund.status = "Approved";
    json(res, 200, { ok: true, refund_id });
  },

  "POST /mock/contract/execute_refund": async (req, res) => {
    const body = await readBody(req);
    const { refund_id } = body;

    if (!refund_id) return badRequest(res, "refund_id required");

    const refund = state.refunds.get(refund_id);
    if (!refund) {
      return json(res, 400, {
        error: "ContractError",
        code: "RefundNotFound",
        message: `No refund found for refund_id: ${refund_id}`,
      });
    }

    if (refund.status !== "Approved") {
      return json(res, 400, {
        error: "ContractError",
        code: "InvalidRefundState",
        message: `Refund is in state ${refund.status}, expected Approved`,
      });
    }

    refund.status = "Executed";

    // Update payment status
    const payment = state.payments.get(refund.order_id);
    if (payment) {
      const totalRefunded = (payment.refunds || [])
        .filter((r) => r.status === "Executed")
        .reduce((sum, r) => sum + r.amount, 0);

      payment.status =
        totalRefunded >= payment.amount ? "FullyRefunded" : "PartiallyRefunded";
    }

    json(res, 200, { ok: true, refund_id });
  },

  "GET /mock/contract/get_refund": (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const refund_id = url.searchParams.get("refund_id");

    if (!refund_id) return badRequest(res, "refund_id query param required");

    const refund = state.refunds.get(refund_id);
    if (!refund) {
      return json(res, 404, {
        error: "ContractError",
        code: "RefundNotFound",
        message: `No refund found for refund_id: ${refund_id}`,
      });
    }

    json(res, 200, refund);
  },

  "GET /mock/contract/get_payment": (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const order_id = url.searchParams.get("order_id");

    if (!order_id) return badRequest(res, "order_id query param required");

    const payment = state.payments.get(order_id);
    if (!payment) {
      return json(res, 404, {
        error: "ContractError",
        code: "PaymentNotFound",
        message: `No payment found for order_id: ${order_id}`,
      });
    }

    json(res, 200, payment);
  },
};

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  // Strip query string for route matching
  const pathname = req.url.split("?")[0];
  const key = `${req.method} ${pathname}`;
  const handler = routes[key];

  if (handler) {
    try {
      await handler(req, res);
    } catch (err) {
      console.error("Handler error:", err);
      json(res, 500, { error: "InternalError", message: String(err) });
    }
  } else {
    notFound(res);
  }
});

server.listen(PORT, () => {
  console.log(`Mock contract server listening on http://localhost:${PORT}`);
});
