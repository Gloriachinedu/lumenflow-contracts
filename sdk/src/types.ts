/**
 * TypeScript types covering all LumenFlow contract outputs.
 * Mirrors the Rust types defined in contracts/lumenflow/src/types.rs
 */

// ── Enums ────────────────────────────────────────────────────────────────────

export type MerchantCategory =
  | "Retail"
  | "Food"
  | "Services"
  | "Digital"
  | "Other";

export type PaymentStatus =
  | "Completed"
  | "PartiallyRefunded"
  | "FullyRefunded";

export type RefundStatus =
  | "Pending"
  | "Approved"
  | "Rejected"
  | "Completed";

export type SortField = "Date" | "Amount";
export type SortOrder = "Ascending" | "Descending";

// ── Merchant ─────────────────────────────────────────────────────────────────

export interface MerchantProfile {
  address: string;
  name: string;
  description: string;
  contactInfo: string;
  category: MerchantCategory;
  registeredAt: bigint;
  isActive: boolean;
  totalPayments: bigint;
  totalVolume: bigint;
}

// ── Payment ───────────────────────────────────────────────────────────────────

export interface PaymentRecord {
  orderId: string;
  payer: string;
  merchantAddress: string;
  tokenAddress: string;
  amount: bigint;
  memo: string;
  paidAt: bigint;
  status: PaymentStatus;
  refundedAmount: bigint;
}

// ── Payment history page ──────────────────────────────────────────────────────

export interface PaymentFilter {
  dateStart?: bigint;
  dateEnd?: bigint;
  amountMin?: bigint;
  amountMax?: bigint;
  token?: string;
  status?: PaymentStatus | "Any";
}

export interface PaymentPage {
  items: PaymentRecord[];
  nextCursor: string | null;
}

// ── Refund ───────────────────────────────────────────────────────────────────

export interface RefundRecord {
  refundId: string;
  orderId: string;
  initiator: string;
  amount: bigint;
  reason: string;
  status: RefundStatus;
  createdAt: bigint;
  updatedAt: bigint;
}

// ── Multi-signature payment ───────────────────────────────────────────────────

export interface MultisigPayment {
  paymentId: string;
  initiator: string;
  merchantAddress: string;
  tokenAddress: string;
  amount: bigint;
  signers: string[];
  requiredSignatures: number;
  collectedSignatures: number;
  executed: boolean;
  createdAt: bigint;
}

// ── Global stats ──────────────────────────────────────────────────────────────

export interface GlobalPaymentStats {
  totalPayments: bigint;
  totalVolume: bigint;
  totalRefunds: bigint;
  totalRefundVolume: bigint;
  activeMerchants: bigint;
}

// ── Network config ────────────────────────────────────────────────────────────

export type NetworkName = "local" | "testnet" | "mainnet";

/** Well-known network presets. */
export const NETWORK_PRESETS: Record<
  NetworkName,
  { rpcUrl: string; networkPassphrase: string }
> = {
  local: {
    rpcUrl: "http://localhost:8000/soroban/rpc",
    networkPassphrase: "Standalone Network ; February 2017",
  },
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    rpcUrl: "https://soroban-mainnet.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
};

export interface ClientConfig {
  /** Named network preset — sets rpcUrl and networkPassphrase automatically. */
  network?: NetworkName;
  /** Override or set the Soroban RPC endpoint. */
  rpcUrl?: string;
  /** Override or set the network passphrase used for transaction signing. */
  networkPassphrase?: string;
  /** Deployed contract ID. */
  contractId: string;
  /** Source account secret key. */
  sourceAccount?: string;
}
