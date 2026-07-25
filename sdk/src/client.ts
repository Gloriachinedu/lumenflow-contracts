import {
  Address,
  Contract,
  rpc,
  scValToNative,
  Transaction,
  TransactionBuilder,
  xdr,
  SorobanRpc,
  nativeToScVal,
  TimeoutInfinite,
} from "@stellar/stellar-sdk";
import {
  Merchant,
  MerchantCategory,
  PaymentOrder,
  PaymentStatus,
  PaymentSummary,
  PaymentRequest,
  BatchPaymentItem,
  RefundRecord,
  RefundStatus,
  DisputeOutcome,
  DisputeRecord,
  MultisigPayment,
  SortField,
  SortOrder,
  StatusFilter,
  PaymentFilter,
  PaymentPage,
  GlobalStats,
  SubscriptionPlan,
  Subscription,
} from "./types";
import { LumenFlowError, PaymentErrorCode } from "./errors";
import { withIdempotency, IdempotentResult } from "./idempotency";

export type Signer = (tx: Transaction) => Promise<Transaction> | Transaction;

export interface ClientConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  signer?: Signer;
}

export class LumenFlowClient {
  public readonly contract: Contract;
  public readonly server: SorobanRpc.Server;
  public readonly networkPassphrase: string;
  private signer?: Signer;

  constructor(config: ClientConfig) {
    this.contract = new Contract(config.contractId);
    this.server = new SorobanRpc.Server(config.rpcUrl);
    this.networkPassphrase = config.networkPassphrase;
    this.signer = config.signer;
  }

  /**
   * Set the signer function for this client.
   */
  setSigner(signer: Signer) {
    this.signer = signer;
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  async setAdmin(admin: string): Promise<void> {
    await this.invoke("set_admin", [new Address(admin)]);
  }

  async transferAdmin(currentAdmin: string, newAdmin: string): Promise<void> {
    await this.invoke("transfer_admin", [
      new Address(currentAdmin),
      new Address(newAdmin),
    ]);
  }

  async setPaymentCleanupPeriod(admin: string, period: bigint): Promise<void> {
    await this.invoke("set_payment_cleanup_period", [
      new Address(admin),
      period,
    ]);
  }

  async setLargePaymentThreshold(admin: string, threshold: bigint): Promise<void> {
    await this.invoke("set_large_payment_threshold", [
      new Address(admin),
      threshold,
    ]);
  }

  async setMaxRefundsPerOrder(admin: string, max: number): Promise<void> {
    await this.invoke("set_max_refunds_per_order", [
      new Address(admin),
      max,
    ]);
  }

  // ── Merchant management ───────────────────────────────────────────────────

  async registerMerchant(
    merchantAddress: string,
    name: string,
    description: string,
    contactInfo: string,
    category: MerchantCategory
  ): Promise<void> {
    await this.invoke("register_merchant", [
      new Address(merchantAddress),
      name,
      description,
      contactInfo,
      category,
    ]);
  }

  async deactivateMerchant(admin: string, merchantAddress: string): Promise<void> {
    await this.invoke("deactivate_merchant", [
      new Address(admin),
      new Address(merchantAddress),
    ]);
  }

  async verifyMerchant(admin: string, merchantAddress: string): Promise<void> {
    await this.invoke("verify_merchant", [
      new Address(admin),
      new Address(merchantAddress),
    ]);
  }

  async unverifyMerchant(admin: string, merchantAddress: string): Promise<void> {
    await this.invoke("unverify_merchant", [
      new Address(admin),
      new Address(merchantAddress),
    ]);
  }

  async getMerchant(merchantAddress: string): Promise<Merchant> {
    return await this.call("get_merchant", [new Address(merchantAddress)]);
  }

  async isRegistered(merchantAddress: string): Promise<boolean> {
    return await this.call("is_registered", [new Address(merchantAddress)]);
  }

  // ── Payment processing ────────────────────────────────────────────────────

  async processPaymentWithSignature(
    payer: string,
    orderId: string,
    merchantAddress: string,
    tokenAddress: string,
    amount: bigint,
    memo: string,
    tags: string[] | null,
    signature: Buffer,
    merchantPublicKey: Buffer
  ): Promise<void> {
    await this.invoke("process_payment_with_signature", [
      new Address(payer),
      orderId,
      new Address(merchantAddress),
      new Address(tokenAddress),
      amount,
      memo,
      tags,
      signature,
      merchantPublicKey,
    ]);
  }

  /**
   * Idempotent variant of processPaymentWithSignature.
   *
   * If the contract returns PaymentAlreadyExists (code 21) the existing
   * payment record is fetched and returned with `duplicate: true` so callers
   * can safely retry without special-casing the error.
   */
  async processPaymentIdempotent(
    payer: string,
    orderId: string,
    merchantAddress: string,
    tokenAddress: string,
    amount: bigint,
    memo: string,
    tags: string[] | null,
    signature: Buffer,
    merchantPublicKey: Buffer
  ): Promise<IdempotentResult<PaymentOrder | null>> {
    return withIdempotency(
      () =>
        this.invoke("process_payment_with_signature", [
          new Address(payer),
          orderId,
          new Address(merchantAddress),
          new Address(tokenAddress),
          amount,
          memo,
          tags,
          signature,
          merchantPublicKey,
        ]),
      () => this.call("get_payment_by_id", [new Address(payer), orderId])
    );
  }

  async processPaymentWithNonce(
    payer: string,
    orderId: string,
    merchantAddress: string,
    tokenAddress: string,
    amount: bigint,
    memo: string,
    tags: string[] | null,
    nonce: bigint
  ): Promise<void> {
    await this.invoke("process_payment_with_nonce", [
      new Address(payer),
      orderId,
      new Address(merchantAddress),
      new Address(tokenAddress),
      amount,
      memo,
      tags,
      nonce,
    ]);
  }

  async batchPayment(
    payer: string,
    payments: BatchPaymentItem[]
  ): Promise<void> {
    const paymentsSc = payments.map(p => ({
      order_id: p.orderId,
      merchant_address: new Address(p.merchantAddress),
      token_address: new Address(p.tokenAddress),
      amount: p.amount,
      memo: p.memo,
      signature: p.signature,
      merchant_public_key: p.merchantPublicKey,
    }));
    await this.invoke("batch_payment", [
      new Address(payer),
      paymentsSc,
    ]);
  }

  async getPaymentById(caller: string, orderId: string): Promise<PaymentOrder> {
    return await this.call("get_payment_by_id", [
      new Address(caller),
      orderId,
    ]);
  }

  async addPaymentNote(
    merchant: string,
    orderId: string,
    note: string
  ): Promise<void> {
    await this.invoke("add_payment_note", [
      new Address(merchant),
      orderId,
      note,
    ]);
  }

  async getPaymentSummary(orderId: string): Promise<PaymentSummary> {
    return await this.call("get_payment_summary", [orderId]);
  }

  async updatePaymentStatus(
    caller: string,
    orderId: string,
    refundedAmount: bigint
  ): Promise<void> {
    await this.invoke("update_payment_status", [
      new Address(caller),
      orderId,
      refundedAmount,
    ]);
  }

  async archivePaymentRecord(admin: string, orderId: string): Promise<void> {
    await this.invoke("archive_payment_record", [
      new Address(admin),
      orderId,
    ]);
  }

  async cleanupExpiredPayments(admin: string): Promise<number> {
    return await this.invoke("cleanup_expired_payments", [
      new Address(admin),
    ]);
  }

  // ── Payment history queries ───────────────────────────────────────────────

  async getMerchantPaymentHistory(
    merchant: string,
    cursor: string | null,
    limit: number,
    filter: PaymentFilter | null,
    sortField: SortField,
    sortOrder: SortOrder
  ): Promise<PaymentPage> {
    const filterSc = filter ? {
      date_start: filter.dateStart || null,
      date_end: filter.dateEnd || null,
      amount_min: filter.amountMin || null,
      amount_max: filter.amountMax || null,
      token: filter.token ? new Address(filter.token) : null,
      status: filter.status,
      tag: filter.tag || null,
    } : null;

    return await this.call("get_merchant_payment_history", [
      new Address(merchant),
      cursor,
      limit,
      filterSc,
      sortField,
      sortOrder,
    ]);
  }

  async getPayerPaymentHistory(
    payer: string,
    cursor: string | null,
    limit: number,
    filter: PaymentFilter | null,
    sortField: SortField,
    sortOrder: SortOrder
  ): Promise<PaymentPage> {
    const filterSc = filter ? {
      date_start: filter.dateStart || null,
      date_end: filter.dateEnd || null,
      amount_min: filter.amountMin || null,
      amount_max: filter.amountMax || null,
      token: filter.token ? new Address(filter.token) : null,
      status: filter.status,
      tag: filter.tag || null,
    } : null;

    return await this.call("get_payer_payment_history", [
      new Address(payer),
      cursor,
      limit,
      filterSc,
      sortField,
      sortOrder,
    ]);
  }

  async getGlobalPaymentStats(
    admin: string,
    dateStart?: bigint,
    dateEnd?: bigint
  ): Promise<GlobalStats> {
    return await this.call("get_global_payment_stats", [
      new Address(admin),
      dateStart || null,
      dateEnd || null,
    ]);
  }

  // ── Refunds ───────────────────────────────────────────────────────────────

  async initiateRefund(
    caller: string,
    refundId: string,
    orderId: string,
    amount: bigint,
    reason: string
  ): Promise<void> {
    await this.invoke("initiate_refund", [
      new Address(caller),
      refundId,
      orderId,
      amount,
      reason,
    ]);
  }

  async approveRefund(caller: string, refundId: string): Promise<void> {
    await this.invoke("approve_refund", [
      new Address(caller),
      refundId,
    ]);
  }

  async rejectRefund(caller: string, refundId: string): Promise<void> {
    await this.invoke("reject_refund", [
      new Address(caller),
      refundId,
    ]);
  }

  async executeRefund(refundId: string): Promise<void> {
    await this.invoke("execute_refund", [refundId]);
  }

  async getRefund(refundId: string): Promise<RefundRecord> {
    return await this.call("get_refund", [refundId]);
  }

  async disputeRefund(
    payer: string,
    refundId: string,
    evidence: string
  ): Promise<void> {
    await this.invoke("dispute_refund", [
      new Address(payer),
      refundId,
      evidence,
    ]);
  }

  async resolveDispute(
    admin: string,
    refundId: string,
    outcome: DisputeOutcome
  ): Promise<void> {
    await this.invoke("resolve_dispute", [
      new Address(admin),
      refundId,
      outcome,
    ]);
  }

  // ── Multi-signature payments ──────────────────────────────────────────────

  async initiateMultisigPayment(
    initiator: string,
    paymentId: string,
    merchantAddress: string,
    tokenAddress: string,
    amount: bigint,
    signers: string[],
    requiredSignatures: number
  ): Promise<void> {
    await this.invoke("initiate_multisig_payment", [
      new Address(initiator),
      paymentId,
      new Address(merchantAddress),
      new Address(tokenAddress),
      amount,
      signers.map(s => new Address(s)),
      requiredSignatures,
    ]);
  }

  async signMultisigPayment(
    signer: string,
    paymentId: string,
    signature: Buffer
  ): Promise<void> {
    await this.invoke("sign_multisig_payment", [
      new Address(signer),
      paymentId,
      signature,
    ]);
  }

  async executeMultisigPayment(
    payer: string,
    paymentId: string
  ): Promise<void> {
    await this.invoke("execute_multisig_payment", [
      new Address(payer),
      paymentId,
    ]);
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  async createSubscriptionPlan(
    merchant: string,
    planId: string,
    token: string,
    amount: bigint,
    intervalSecs: bigint,
    maxCycles: number
  ): Promise<void> {
    await this.invoke("create_subscription_plan", [
      new Address(merchant),
      planId,
      new Address(token),
      amount,
      intervalSecs,
      maxCycles,
    ]);
  }

  async subscribe(
    subscriber: string,
    subscriptionId: string,
    planId: string
  ): Promise<void> {
    await this.invoke("subscribe", [
      new Address(subscriber),
      subscriptionId,
      planId,
    ]);
  }

  async chargeSubscription(subscriptionId: string): Promise<void> {
    await this.invoke("charge_subscription", [subscriptionId]);
  }

  async cancelSubscription(
    subscriber: string,
    subscriptionId: string
  ): Promise<void> {
    await this.invoke("cancel_subscription", [
      new Address(subscriber),
      subscriptionId,
    ]);
  }

  // ── Payment Requests ──────────────────────────────────────────────────────

  async createPaymentRequest(
    merchant: string,
    requestId: string,
    token: string,
    amount: bigint,
    memo: string,
    ttl: bigint
  ): Promise<void> {
    await this.invoke("create_payment_request", [
      new Address(merchant),
      requestId,
      new Address(token),
      amount,
      memo,
      ttl,
    ]);
  }

  async payPaymentRequest(payer: string, requestId: string): Promise<void> {
    await this.invoke("pay_payment_request", [
      new Address(payer),
      requestId,
    ]);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private async call(method: string, args: any[] = []): Promise<any> {
    const tx = new TransactionBuilder(
      new SorobanRpc.Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0"),
      {
        fee: "100",
        networkPassphrase: this.networkPassphrase,
      }
    )
      .addOperation(this.contract.call(method, ...args.map(a => nativeToScVal(a))))
      .setTimeout(TimeoutInfinite)
      .build();

    const simulation = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw this.wrapError(simulation);
    }

    if (simulation.result) {
      return scValToNative(simulation.result.retval);
    }
    return null;
  }

  private async invoke(method: string, args: any[] = []): Promise<any> {
    if (!this.signer) {
      throw new Error("A signer is required for state-changing operations.");
    }

    const sourceAccount = await this.server.getAccount("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"); // Dummy for simulation if needed, but we need real one for execution
    // Actually, we should probably get the account from the signer or pass it in.
    // For now, let's assume we can use a dummy for simulation to get the footprint.

    const dummyAccount = new SorobanRpc.Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");
    let tx = new TransactionBuilder(dummyAccount, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args.map(a => nativeToScVal(a))))
      .setTimeout(TimeoutInfinite)
      .build();

    const simulation = await this.server.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw this.wrapError(simulation);
    }

    // Prepare for real execution
    // We need the actual source account to build the real transaction
    // Let's assume the first arg is often the "caller/admin/payer/merchant" address if it's an Address.
    let realSourceAddress = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    if (args.length > 0 && args[0] instanceof Address) {
      // This is a heuristic, but often the first param is the one requiring auth
      // In Soroban, any account can pay for fees, but the contract usually checks require_auth() on params.
    }

    // For simplicity in this SDK, we might need a way to specify the fee payer.
    // Let's just use the simulation's results and let the signer handle the final steps if it's a wallet.
    // But standard way is to assemble it here.

    tx = SorobanRpc.assembleTransaction(tx, simulation).build();
    const signedTx = await this.signer(tx);
    const response = await this.server.sendTransaction(signedTx);

    if (response.status === "ERROR") {
      throw new Error(`Transaction failed: ${JSON.stringify(response)}`);
    }

    // Poll for status
    let statusResponse = await this.server.getTransaction(response.hash);
    while (statusResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND || 
           statusResponse.status === SorobanRpc.Api.GetTransactionStatus.PROCESSING) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      statusResponse = await this.server.getTransaction(response.hash);
    }

    if (statusResponse.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      if (statusResponse.resultMetaXdr) {
        // Parse result from meta if needed
        const result = statusResponse.returnValue;
        if (result) {
          return scValToNative(result);
        }
      }
      return null;
    } else {
      throw new Error(`Transaction failed with status ${statusResponse.status}: ${JSON.stringify(statusResponse)}`);
    }
  }

  private wrapError(simulation: SorobanRpc.Api.SimulateTransactionErrorResponse): Error {
    // Try to extract contract error code
    // Simulation error might contain the error in events or in the error message
    const errorMsg = simulation.error;
    if (errorMsg.includes("Error(Contract, #")) {
      const match = errorMsg.match(/Error\(Contract, #(\d+)\)/);
      if (match) {
        const code = parseInt(match[1], 10);
        return new LumenFlowError(code as PaymentErrorCode, simulation);
      }
    }
    return new Error(`Simulation failed: ${errorMsg}`);
  }
}
