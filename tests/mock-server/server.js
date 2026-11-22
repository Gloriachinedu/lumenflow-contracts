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

// ── Admin IP allowlist ────────────────────────────────────────────────────────
//
// Comma-separated list of CIDRs (or bare IPs) permitted to reach admin routes.
// Example: ADMIN_IP_ALLOWLIST="127.0.0.1/32,10.0.0.0/8,::1/128"
// When unset, admin routes are reachable only from loopback addresses.

const ADMIN_IP_ALLOWLIST_ENV = process.env.ADMIN_IP_ALLOWLIST;

function parseIPv4(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? parseInt(p, 10) : NaN));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  return nums;
}

function ipv4ToInt(ip) {
  const nums = parseIPv4(ip);
  if (!nums) return null;
  return ((nums[0] << 24) >>> 0) + (nums[1] << 16) + (nums[2] << 8) + nums[3];
}

function normalizeIp(ip) {
  if (!ip) return "";
  // Strip IPv4-mapped IPv6 prefix (::ffff:127.0.0.1 → 127.0.0.1)
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function parseCidr(entry) {
  const trimmed = entry.trim();
  if (!trimmed) return null;

  const [addr, prefixRaw] = trimmed.split("/");
  const ip = normalizeIp(addr);

  if (ip.includes(":")) {
    // IPv6: support exact-match entries only (no prefix math)
    if (prefixRaw !== undefined && prefixRaw !== "128") return null;
    return { family: 6, ip };
  }

  const base = ipv4ToInt(ip);
  if (base === null) return null;

  const prefix = prefixRaw === undefined ? 32 : parseInt(prefixRaw, 10);
  if (Number.isNaN(prefix) || prefix < 0 || prefix > 32) return null;

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { family: 4, network: (base & mask) >>> 0, mask };
}

function parseAllowlist(raw) {
  const source = raw === undefined || raw === null ? "127.0.0.1/32,::1/128" : raw;
  return source
    .split(",")
    .map(parseCidr)
    .filter((entry) => entry !== null);
}

let adminAllowlist = parseAllowlist(ADMIN_IP_ALLOWLIST_ENV);

function setAdminAllowlist(raw) {
  adminAllowlist = parseAllowlist(raw);
}

function ipMatchesEntry(ip, entry) {
  if (entry.family === 6) return ip === entry.ip;
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return ((value & entry.mask) >>> 0) === entry.network;
}

function isIpAllowed(ip) {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  return adminAllowlist.some((entry) => ipMatchesEntry(normalized, entry));
}

function getClientIp(req) {
  // Prefer the socket address; honour X-Forwarded-For only for the first hop.
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return normalizeIp(forwarded.split(",")[0].trim());
  }
  return normalizeIp(req.socket && req.socket.remoteAddress);
}

function adminIpGuard(req, res) {
  if (isIpAllowed(getClientIp(req))) return true;
  // 403 (not 401) so callers cannot infer whether admin auth exists.
  json(res, 403, { error: "Forbidden" });
  return false;
}

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

  // ── Admin endpoints (IP allowlisted) ────────────────────────────────────────

  "POST /mock/admin/pause_contract": async (req, res) => {
    const body = await readBody(req);
    state.contractPaused = true;
    json(res, 200, { ok: true, paused: true, reason: body.reason || null });
  },

  "POST /mock/admin/emergency_withdraw": async (req, res) => {
    const body = await readBody(req);
    json(res, 200, { ok: true, withdrawn: true, destination: body.destination || null });
  },

  "POST /mock/admin/suspend_merchant": async (req, res) => {
    const body = await readBody(req);
    if (!body.address) return badRequest(res, "address required");
    const merchant = state.merchants.get(body.address) || { address: body.address };
    merchant.suspended = true;
    state.merchants.set(body.address, merchant);
    json(res, 200, { ok: true, suspended: true, address: body.address });
  },
};

// Routes that require the caller's IP to be on the admin allowlist.
const ADMIN_ROUTE_PREFIX = "/mock/admin/";

// ── Server ────────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" });
    return res.end();
  }

  // Strip query string for route matching
  const pathname = req.url.split("?")[0];

  // Admin routes are IP allowlisted; non-allowlisted callers get 403.
  if (pathname.startsWith(ADMIN_ROUTE_PREFIX) && !adminIpGuard(req, res)) {
    return;
  }

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

module.exports = {
  server,
  routes,
  isIpAllowed,
  setAdminAllowlist,
  parseAllowlist,
  getClientIp,
};
