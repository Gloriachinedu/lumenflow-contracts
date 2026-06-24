export enum MerchantCategory {
  Retail = "Retail",
  Food = "Food",
  Services = "Services",
  Digital = "Digital",
  Other = "Other",
}

export interface Merchant {
  address: string;
  name: string;
  description: string;
  contactInfo: string;
  category: MerchantCategory;
  active: boolean;
  verified: boolean;
  registeredAt: bigint;
  totalReceived: bigint;
}

export enum PaymentStatus {
  Completed = "Completed",
  PartiallyRefunded = "PartiallyRefunded",
  FullyRefunded = "FullyRefunded",
}

export interface PaymentOrder {
  orderId: string;
  merchantAddress: string;
  payer: string;
  token: string;
  amount: bigint;
  status: PaymentStatus;
  paidAt: bigint;
  refundedAmount: bigint;
  memo: string;
  tags?: string[];
  note?: string;
}

export interface PaymentSummary {
  orderId: string;
  merchantAddress: string;
  amount: bigint;
  token: string;
  status: PaymentStatus;
  paidAt: bigint;
}

export interface PaymentRequest {
  requestId: string;
  merchant: string;
  token: string;
  amount: bigint;
  memo: string;
  expiresAt: bigint;
}

export interface BatchPaymentItem {
  orderId: string;
  merchantAddress: string;
  tokenAddress: string;
  amount: bigint;
  memo: string;
  signature: Buffer;
  merchantPublicKey: Buffer;
}

export enum RefundStatus {
  Pending = "Pending",
  Approved = "Approved",
  Rejected = "Rejected",
  Completed = "Completed",
  Disputed = "Disputed",
}

export interface RefundRecord {
  refundId: string;
  orderId: string;
  initiator: string;
  amount: bigint;
  reason: string;
  status: RefundStatus;
  createdAt: bigint;
}

export enum DisputeOutcome {
  FavorPayer = "FavorPayer",
  FavorMerchant = "FavorMerchant",
}

export interface DisputeRecord {
  refundId: string;
  payer: string;
  evidence: string;
  outcome?: DisputeOutcome;
  createdAt: bigint;
}

export interface MultisigPayment {
  paymentId: string;
  merchantAddress: string;
  token: string;
  amount: bigint;
  requiredSignatures: number;
  signers: string[];
  signatures: Buffer[];
  signedBy: string[];
  executed: boolean;
  createdAt: bigint;
}

export enum SortField {
  Date = "Date",
  Amount = "Amount",
}

export enum SortOrder {
  Ascending = "Ascending",
  Descending = "Descending",
}

export enum StatusFilter {
  Any = "Any",
  Completed = "Completed",
  PartiallyRefunded = "PartiallyRefunded",
  FullyRefunded = "FullyRefunded",
}

export interface PaymentFilter {
  dateStart?: bigint;
  dateEnd?: bigint;
  amountMin?: bigint;
  amountMax?: bigint;
  token?: string;
  status: StatusFilter;
  tag?: string;
}

export interface PaymentPage {
  payments: PaymentOrder[];
  nextCursor?: string;
  total: number;
}

export interface GlobalStats {
  totalPayments: number;
  totalVolume: bigint;
  totalRefunds: number;
  totalRefundVolume: bigint;
  activeMerchants: number;
}

export enum SuspiciousActivityReason {
  LargePayment = 1,
  RapidRefunds = 2,
  ManyAuthFailures = 3,
}

export interface SubscriptionPlan {
  planId: string;
  merchant: string;
  token: string;
  amount: bigint;
  intervalSecs: bigint;
  maxCycles: number;
}

export enum SubscriptionStatus {
  Active = "Active",
  Cancelled = "Cancelled",
  Completed = "Completed",
}

export interface Subscription {
  subscriptionId: string;
  planId: string;
  subscriber: string;
  cyclesCharged: number;
  lastChargedAt: bigint;
  status: SubscriptionStatus;
  createdAt: bigint;
}
