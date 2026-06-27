import { LumenFlowError, PaymentErrorCode } from "./errors";

export interface RpcResponse<T> {
  result: T;
}

export type RpcFetch = (method: string, params: unknown) => Promise<RpcResponse<unknown>>;

const RETRYABLE_CODES = new Set(["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"]);
const MAX_RETRIES = 3;

async function withRetry<T>(fn: () => Promise<T>, retries = MAX_RETRIES): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const isRetryable =
        RETRYABLE_CODES.has(err?.code) ||
        err?.message?.includes("timeout") ||
        err?.message?.includes("network");
      if (!isRetryable || attempt === retries) break;
    }
  }
  throw lastError;
}

export class LumenFlowClient {
  constructor(private readonly rpcFetch: RpcFetch) {}

  async registerMerchant(params: {
    merchant_address: string;
    name: string;
    description: string;
    contact_info: string;
    category: string;
  }): Promise<void> {
    await withRetry(() => this.rpcFetch("register_merchant", params));
  }

  async processPayment(params: {
    payer: string;
    order_id: string;
    merchant_address: string;
    amount: number;
  }): Promise<void> {
    await withRetry(() => this.rpcFetch("process_payment", params));
  }

  async getPaymentById(order_id: string): Promise<unknown> {
    const response = await withRetry(() =>
      this.rpcFetch("get_payment_by_id", { order_id })
    );
    if (!response?.result) {
      throw new LumenFlowError(PaymentErrorCode.PaymentNotFound);
    }
    return response.result;
  }
}
