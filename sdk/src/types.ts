/**
 * TypeScript types covering all LumenFlow contract outputs.
 * Mirrors the Rust types defined in contracts/lumenflow/src/types.rs
 */

export type MerchantCategory = "Retail" | "Food" | "Services" | "Digital" | "Other";
export type PaymentStatus = "Completed" | "PartiallyRefunded" | "FullyRefunded";
export type RefundStatus = "Pending" | "Approved" | "Rejected" | "Completed";
export type SortField = "Date" | "Amount";
export type SortOrder = "Ascending" | "Descending";

export interface MerchantProfile {
  address: string; name: string; description: string; contactInfo: string;
  category: MerchantCategory; registeredAt: bigint; isActive: boolean;
  totalPayments: bigint; totalVolume: bigint;
}

export interface PaymentRecord {
  orderId: string; payer: string; merchantAddress: string; tokenAddress: string;
  amount: bigint; memo: string; paidAt: bigint; status: PaymentStatus; refundedAmount: bigint;
}

export interface PaymentFilter {
  dateStart?: bigint; dateEnd?: bigint; amountMin?: bigint; amountMax?: bigint;
  token?: string; status?: PaymentStatus | "Any";
}

export interface PaymentPage { items: PaymentRecord[]; nextCursor: string | null; }

export interface RefundRecord {
  refundId: string; orderId: string; initiator: string; amount: bigint;
  reason: string; status: RefundStatus; createdAt: bigint; updatedAt: bigint;
}

export interface MultisigPayment {
  paymentId: string; initiator: string; merchantAddress: string; tokenAddress: string;
  amount: bigint; signers: string[]; requiredSignatures: number;
  collectedSignatures: number; executed: boolean; createdAt: bigint;
}

export interface GlobalPaymentStats {
  totalPayments: bigint; totalVolume: bigint; totalRefunds: bigint;
  totalRefundVolume: bigint; activeMerchants: bigint;
}

export type NetworkName = "local" | "testnet" | "mainnet";

export const NETWORK_PRESETS: Record<NetworkName, { rpcUrl: string; networkPassphrase: string }> = {
  local: { rpcUrl: "http://localhost:8000/soroban/rpc", networkPassphrase: "Standalone Network ; February 2017" },
  testnet: { rpcUrl: "https://soroban-testnet.stellar.org", networkPassphrase: "Test SDF Network ; September 2015" },
  mainnet: { rpcUrl: "https://soroban-mainnet.stellar.org", networkPassphrase: "Public Global Stellar Network ; September 2015" },
};

export interface ClientConfig {
  network?: NetworkName;
  rpcUrl?: string;
  networkPassphrase?: string;
  contractId: string;
  sourceAccount?: string;
  /** Retry policy for read-only RPC calls. */
  retry?: import("./retry").RetryConfig;
}
