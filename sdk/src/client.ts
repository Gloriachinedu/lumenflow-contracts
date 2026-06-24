import { resolveNetworkConfig } from "./config";
import { withRetry } from "./retry";
import type {
  ClientConfig,
  GlobalPaymentStats,
  MerchantProfile,
  MultisigPayment,
  PaymentFilter,
  PaymentPage,
  PaymentRecord,
  RefundRecord,
  SortField,
  SortOrder,
} from "./types";

/**
 * LumenFlow SDK client with automatic retry/backoff on transient RPC errors.
 * The retry policy is configurable via ClientConfig.retry.
 */
export class LumenFlowClient {
  readonly rpcUrl: string;
  readonly networkPassphrase: string;
  readonly contractId: string;
  private readonly retryConfig: ClientConfig["retry"];

  constructor(config: ClientConfig) {
    const resolved = resolveNetworkConfig(config);
    this.rpcUrl = resolved.rpcUrl;
    this.networkPassphrase = resolved.networkPassphrase;
    this.contractId = config.contractId;
    this.retryConfig = config.retry;
  }

  /** Wrap a read-only RPC call with the configured retry policy. */
  private read<T>(fn: () => Promise<T>): Promise<T> {
    return withRetry(fn, this.retryConfig);
  }

  async getPaymentById(caller: string, orderId: string): Promise<PaymentRecord> {
    return this.read(() => { throw new Error("Not implemented: wire to Soroban RPC"); });
  }

  async getMerchantPaymentHistory(
    merchant: string, cursor: string | null, limit: number,
    filter: PaymentFilter | null, sortField: SortField, sortOrder: SortOrder
  ): Promise<PaymentPage> {
    return this.read(() => { throw new Error("Not implemented: wire to Soroban RPC"); });
  }

  async getPayerPaymentHistory(
    payer: string, cursor: string | null, limit: number,
    filter: PaymentFilter | null, sortField: SortField, sortOrder: SortOrder
  ): Promise<PaymentPage> {
    return this.read(() => { throw new Error("Not implemented: wire to Soroban RPC"); });
  }

  async getMerchant(merchantAddress: string): Promise<MerchantProfile> {
    return this.read(() => { throw new Error("Not implemented: wire to Soroban RPC"); });
  }

  async getRefund(refundId: string): Promise<RefundRecord> {
    return this.read(() => { throw new Error("Not implemented: wire to Soroban RPC"); });
  }

  async getMultisigPayment(paymentId: string): Promise<MultisigPayment> {
    return this.read(() => { throw new Error("Not implemented: wire to Soroban RPC"); });
  }

  async getGlobalPaymentStats(
    admin: string, dateStart: bigint | null, dateEnd: bigint | null
  ): Promise<GlobalPaymentStats> {
    return this.read(() => { throw new Error("Not implemented: wire to Soroban RPC"); });
  }
}
