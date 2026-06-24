import { resolveNetworkConfig } from "./config";
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
 * Validates config on construction and resolves network preset automatically.
 */
export class LumenFlowClient {
  readonly rpcUrl: string;
  readonly networkPassphrase: string;
  readonly contractId: string;

  constructor(config: ClientConfig) {
    const resolved = resolveNetworkConfig(config);
    this.rpcUrl = resolved.rpcUrl;
    this.networkPassphrase = resolved.networkPassphrase;
    this.contractId = config.contractId;
  }

  async getPaymentById(caller: string, orderId: string): Promise<PaymentRecord> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }

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

  async getMerchant(merchantAddress: string): Promise<MerchantProfile> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }

  async getRefund(refundId: string): Promise<RefundRecord> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }

  async getMultisigPayment(paymentId: string): Promise<MultisigPayment> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }

  async getGlobalPaymentStats(
    admin: string,
    dateStart: bigint | null,
    dateEnd: bigint | null
  ): Promise<GlobalPaymentStats> {
    throw new Error("Not implemented: wire to Soroban RPC");
  }
}
