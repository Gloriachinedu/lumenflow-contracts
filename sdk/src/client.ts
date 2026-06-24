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
 * LumenFlow SDK client.
 * Wraps read-only contract queries with fully-typed return values.
 */
export class LumenFlowClient {
  readonly config: ClientConfig;

  constructor(config: ClientConfig) {
    this.config = config;
  }

  /** Fetch a single payment by order ID. */
  async getPaymentById(
    caller: string,
    orderId: string
  ): Promise<PaymentRecord> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }

  /** Fetch paginated merchant payment history. */
  async getMerchantPaymentHistory(
    merchant: string,
    cursor: string | null,
    limit: number,
    filter: PaymentFilter | null,
    sortField: SortField,
    sortOrder: SortOrder
  ): Promise<PaymentPage> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }

  /** Fetch paginated payer payment history. */
  async getPayerPaymentHistory(
    payer: string,
    cursor: string | null,
    limit: number,
    filter: PaymentFilter | null,
    sortField: SortField,
    sortOrder: SortOrder
  ): Promise<PaymentPage> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }

  /** Fetch a merchant profile. */
  async getMerchant(merchantAddress: string): Promise<MerchantProfile> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }

  /** Fetch a refund record. */
  async getRefund(refundId: string): Promise<RefundRecord> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }

  /** Fetch a multisig payment. */
  async getMultisigPayment(paymentId: string): Promise<MultisigPayment> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }

  /** Fetch global statistics (admin only). */
  async getGlobalPaymentStats(
    admin: string,
    dateStart: bigint | null,
    dateEnd: bigint | null
  ): Promise<GlobalPaymentStats> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }
}
