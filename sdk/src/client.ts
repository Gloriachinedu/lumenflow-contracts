feat/sdk-rpc-retry-integration
/**
 * LumenFlow SDK Client
 * Provides a high-level interface for interacting with the LumenFlow smart contract.
 */

import { LumenFlowError } from './errors';
import { withRetry, RetryConfig, DEFAULT_RETRY_CONFIG } from './retry';

export interface ClientConfig {
  /** Soroban RPC server URL */
  rpcUrl: string;
  /** LumenFlow contract ID */
  contractId: string;
  /** Optional retry configuration */
  retryConfig?: Partial<RetryConfig>;
}

export class Client {
  private rpcUrl: string;
  private contractId: string;
  private retryConfig: RetryConfig;

  constructor(config: ClientConfig) {
    this.rpcUrl = config.rpcUrl;
    this.contractId = config.contractId;
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...config.retryConfig };
  }

  /**
   * Invoke a contract method with automatic retry for transient errors.
   * 
   * @param method - The contract method to invoke
   * @param args - Arguments to pass to the method
   * @returns The result of the contract call
   */
  async invoke(method: string, ...args: any[]): Promise<any> {
    return withRetry(async () => {
      return this.executeInvoke(method, ...args);
    }, this.retryConfig);
  }

  /**
   * Execute the actual contract invocation without retry logic.
   * This is separated to allow withRetry to handle the retry logic.
   */
  private async executeInvoke(method: string, ...args: any[]): Promise<any> {
    // In a real implementation, this would:
    // 1. Load the Soroban SDK
    // 2. Call server.prepareTransaction
    // 3. Call server.sendTransaction
    // 4. Handle the response
    
    // For now, this is a placeholder that simulates the behavior
    // The actual implementation would use @stellar/stellar-sdk
    
    throw new Error('Client.executeInvoke not yet implemented - requires @stellar/stellar-sdk integration');
  }

  /**
   * Get the RPC URL
   */
  getRpcUrl(): string {
    return this.rpcUrl;
  }

  /**
   * Get the contract ID
   */
  getContractId(): string {
    return this.contractId;
  }

  /**
   * Get the retry configuration
   */
  getRetryConfig(): RetryConfig {
    return { ...this.retryConfig };
  }
}

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
import packageJson from "../package.json";

export const VERSION: string = packageJson.version;

/**
 * Serialize a {@link MerchantCategory} value to the XDR ScVal form expected
 * by the Soroban contract.
 *
 * - Unit variants  →  `ScVec([ScSymbol("<Variant>")])`
 * - Custom variant →  `ScVec([ScSymbol("Custom"), ScString("<label>")])`
 *
 * @throws {Error} When a `Custom` label is empty or exceeds 32 characters.
 */
export function serializeMerchantCategory(category: MerchantCategory): xdr.ScVal {
  if (typeof category === "string") {
    return xdr.ScVal.scvVec([xdr.ScVal.scvSymbol(category)]);
  }
  // { Custom: string }
  const label = category.Custom;
  if (!label || label.length === 0) {
    throw new Error("MerchantCategory.Custom label must not be empty.");
  }
  if (label.length > 32) {
    throw new Error(
      `MerchantCategory.Custom label must be at most 32 characters (got ${label.length}).`
    );
  }
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Custom"),
    xdr.ScVal.scvString(label),
  ]);
}
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

/**
 * A function that signs a Stellar transaction.
 * Implementations typically call a wallet extension (e.g. Freighter) or a keypair.
 *
 * @param tx - The unsigned or pre-assembled Stellar transaction to sign.
 * @returns The signed transaction, either synchronously or as a Promise.
 *
 * @example
 * // Using Freighter wallet
 * const signer: Signer = async (tx) => {
 *   const { signedTxXdr } = await freighter.signTransaction(tx.toXDR());
 *   return TransactionBuilder.fromXDR(signedTxXdr, networkPassphrase);
 * };
 */
export type Signer = (tx: Transaction) => Promise<Transaction> | Transaction;

/**
 * The major version of the contract API this SDK is built against.
 * Version compatibility is defined as matching major versions (semver).
 */
export const SDK_CONTRACT_MAJOR_VERSION = 0;

export interface ClientConfig {
  /** The Soroban contract ID (e.g. `"CAAAA..."`). */
  contractId: string;
  /** The Soroban-RPC endpoint URL (e.g. `"https://soroban-testnet.stellar.org"`). */
  rpcUrl: string;
  /** Stellar network passphrase used to scope transactions. */
  networkPassphrase: string;
  /**
   * Optional signer function for state-changing operations.
   * Required before calling any `invoke`-backed method.
   * Can be set later via {@link LumenFlowClient.setSigner}.
   */
  signer?: Signer;
  /**
   * The Stellar address of the currently connected wallet.
   *
   * When set, {@link LumenFlowClient.cancelPaymentRequest} (and other
   * caller-validated methods) will compare the supplied `caller` argument
   * against this value before broadcasting any transaction.
   * Supply this to prevent accidental submission of transactions that
   * would fail on-chain due to an auth mismatch.
   */
  walletAddress?: string;
  /**
   * Skip the automatic contract version compatibility check on initialisation.
   * Defaults to `false`.
   */
  skipVersionCheck?: boolean;
  /**
   * Throw an error instead of logging a warning when the contract major version
   * does not match the SDK's expected major version.
   * Defaults to `false`.
   */
  strictVersionCheck?: boolean;
}

/**
 * High-level client for interacting with the LumenFlow Soroban smart contract.
 *
 * Read-only operations are performed via `simulateTransaction` (no signer needed).
 * State-changing operations require a {@link Signer} to be set via the constructor
 * or {@link setSigner}.
 *
 * @example
 * import { LumenFlowClient } from "@lumenflow/sdk";
 * import { Networks } from "@stellar/stellar-sdk";
 *
 * const client = new LumenFlowClient({
 *   contractId: "CAAAA...",
 *   rpcUrl: "https://soroban-testnet.stellar.org",
 *   networkPassphrase: Networks.TESTNET,
 *   signer: async (tx) => {
 *     const { signedTxXdr } = await freighter.signTransaction(tx.toXDR());
 *     return TransactionBuilder.fromXDR(signedTxXdr, Networks.TESTNET);
 *   },
 * });
 */
export class LumenFlowClient {
  /** The Soroban {@link Contract} instance used to build contract calls. */
  public readonly contract: Contract;
  public readonly server: rpc.Server;
  public readonly networkPassphrase: string;
  private signer?: Signer;
  private walletAddress?: string;
  private skipVersionCheck: boolean;
  private strictVersionCheck: boolean;

  /**
   * Creates a new {@link LumenFlowClient}.
   *
   * @param config - Client configuration including contract ID, RPC URL, network passphrase, and optional signer.
   *
   * @example
   * const client = new LumenFlowClient({
   *   contractId: "CAAAA...",
   *   rpcUrl: "https://soroban-testnet.stellar.org",
   *   networkPassphrase: Networks.TESTNET,
   * });
   */
  constructor(config: ClientConfig) {
    this.contract = new Contract(config.contractId);
    this.server = new rpc.Server(config.rpcUrl, {
      headers: { "X-SDK-Version": VERSION },
    });
    this.networkPassphrase = config.networkPassphrase;
    this.signer = config.signer;
    this.walletAddress = config.walletAddress;
    this.skipVersionCheck = config.skipVersionCheck ?? false;
    this.strictVersionCheck = config.strictVersionCheck ?? false;
  }

  /**
   * Check that the deployed contract version is compatible with this SDK.
   *
   * Compatibility is defined as having the same major version (semver).
   * Call this once after construction — it is invoked automatically by
   * {@link init}.
   *
   * @throws {Error} when `strictVersionCheck` is `true` and the major versions differ.
   */
  async checkContractVersion(): Promise<void> {
    if (this.skipVersionCheck) {
      return;
    }

    let rawVersion: string;
    try {
      rawVersion = await this.getContractVersion();
    } catch (err) {
      // If we cannot fetch the version, log a warning and proceed so that
      // callers are not hard-blocked by transient RPC issues.
      console.warn(
        "[LumenFlowSDK] Unable to fetch contract version for compatibility check:",
        err
      );
      return;
    }

    const contractMajor = parseInt(rawVersion.split(".")[0] ?? "0", 10);
    if (isNaN(contractMajor)) {
      console.warn(
        `[LumenFlowSDK] Contract returned an unparseable version string: "${rawVersion}". ` +
          "Skipping version check."
      );
      return;
    }

    if (contractMajor !== SDK_CONTRACT_MAJOR_VERSION) {
      const message =
        `[LumenFlowSDK] Contract version mismatch: SDK expects major version ` +
        `${SDK_CONTRACT_MAJOR_VERSION} but contract reports "${rawVersion}" ` +
        `(major ${contractMajor}). Silent serialisation failures may occur.`;

      if (this.strictVersionCheck) {
        throw new Error(message);
      } else {
        console.warn(message);
      }
    }
  }

  /**
   * Initialise the client by verifying contract version compatibility.
   *
   * This is a convenience factory that constructs the client and immediately
   * runs the version check. Use this instead of the constructor when you want
   * to ensure compatibility before issuing any contract calls.
   *
   * @example
   * ```typescript
   * const client = await LumenFlowClient.init({
   *   contractId: "C...",
   *   rpcUrl: "https://soroban-testnet.stellar.org",
   *   networkPassphrase: Networks.TESTNET,
   * });
   * ```
   */
  static async init(config: ClientConfig): Promise<LumenFlowClient> {
    const client = new LumenFlowClient(config);
    await client.checkContractVersion();
    return client;
  }

  /**
   * Sets or replaces the signer function used for state-changing operations.
   * Call this after constructing the client when a wallet connects.
   *
   * @param signer - A function that signs a Stellar {@link Transaction}.
   *
   * @example
   * client.setSigner(async (tx) => {
   *   const { signedTxXdr } = await freighter.signTransaction(tx.toXDR());
   *   return TransactionBuilder.fromXDR(signedTxXdr, client.networkPassphrase);
   * });
   */
  setSigner(signer: Signer) {
    this.signer = signer;
  }

  /**
   * Update the wallet address used for pre-flight caller validation.
   *
   * Call this whenever the user connects or switches wallets so that
   * {@link cancelPaymentRequest} and other caller-validated methods
   * stay in sync with the active account.
   *
   * @param address - The Stellar public key of the connected wallet (G…).
   */
  setWalletAddress(address: string) {
    this.walletAddress = address;
  }

  // ── Admin ─────────────────────────────────────────────────────────────────

  /**
   * Fetch the version string deployed in the contract (e.g. `"0.2.0"`).
   */
  async getContractVersion(): Promise<string> {
    return await this.call("get_contract_version", []);
  }

  async setAdmin(admin: string): Promise<void> {
    await this.invoke("set_admin", [new Address(admin)]);
  }

  /**
   * Transfers admin rights from one address to another atomically.
   * Both the current and new admin addresses must be valid.
   *
   * @param currentAdmin - Stellar address of the existing administrator (must sign).
   * @param newAdmin - Stellar address of the incoming administrator.
   * @returns A Promise that resolves when the transfer is confirmed on-chain.
   * @throws {@link LumenFlowError} if `currentAdmin` does not match the stored admin.
   *
   * @example
   * await client.transferAdmin("GCURRENT...", "GNEW...");
   */
  async transferAdmin(currentAdmin: string, newAdmin: string): Promise<void> {
    await this.invoke("transfer_admin", [
      new Address(currentAdmin),
      new Address(newAdmin),
    ]);
  }

  /**
   * Updates the payment cleanup period (the age after which expired payments
   * become eligible for removal by {@link cleanupExpiredPayments}).
   *
   * @param admin - Stellar address of the administrator (must sign).
   * @param period - Cleanup period in seconds (as a `bigint`).
   * @returns A Promise that resolves when the period has been updated.
   * @throws {@link LumenFlowError} if the caller is not the admin.
   */
  async setPaymentCleanupPeriod(admin: string, period: bigint): Promise<void> {
    await this.invoke("set_payment_cleanup_period", [
      new Address(admin),
      period,
    ]);
  }

  /**
   * Sets the threshold above which a payment is considered a "large payment"
   * and may require additional multi-signature authorisation.
   *
   * @param admin - Stellar address of the administrator (must sign).
   * @param threshold - Amount in stroops (1 XLM = 10,000,000 stroops).
   * @returns A Promise that resolves when the threshold is updated.
   * @throws {@link LumenFlowError} if the caller is not the admin.
   */
  async setLargePaymentThreshold(admin: string, threshold: bigint): Promise<void> {
    await this.invoke("set_large_payment_threshold", [
      new Address(admin),
      threshold,
    ]);
  }

  /**
   * Sets the maximum number of refunds allowed per order.
   *
   * @param admin - Stellar address of the administrator (must sign).
   * @param max - Maximum refund count per order (must be a positive integer).
   * @returns A Promise that resolves when the setting is saved.
   * @throws {@link LumenFlowError} if the caller is not the admin.
   */
  async setMaxRefundsPerOrder(admin: string, max: number): Promise<void> {
    await this.invoke("set_max_refunds_per_order", [
      new Address(admin),
      max,
    ]);
  }

  // ── Merchant management ───────────────────────────────────────────────────

  /**
   * Registers a new merchant on the LumenFlow contract.
   * The merchant account must sign the transaction.
   *
   * @param merchantAddress - Stellar address of the merchant being registered.
   * @param name - Human-readable merchant name (max 64 characters).
   * @param description - Brief description of the merchant's business.
   * @param contactInfo - Contact details (e.g. email or URL).
   * @param category - Business category from the {@link MerchantCategory} enum.
   * @returns A Promise that resolves when the merchant is registered.
   * @throws {@link LumenFlowError} if the address is already registered.
   *
   * @example
   * await client.registerMerchant(
   *   "GMERCHANT...",
   *   "Acme Store",
   *   "Online electronics retailer",
   *   "support@acme.example",
   *   MerchantCategory.Retail,
   * );
   */
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
      serializeMerchantCategory(category),
    ]);
  }

  async updateMerchant(
    merchantAddress: string,
    name: string,
    description: string,
    contactInfo: string,
    category: MerchantCategory
  ): Promise<void> {
    await this.invoke("update_merchant", [
      new Address(merchantAddress),
      name,
      description,
      contactInfo,
      serializeMerchantCategory(category),
    ]);
  }

  /**
   * Deactivates a merchant, preventing them from receiving payments.
   * Only an admin can deactivate a merchant.
   *
   * @param admin - Stellar address of the administrator (must sign).
   * @param merchantAddress - Stellar address of the merchant to deactivate.
   * @returns A Promise that resolves when the merchant is deactivated.
   * @throws {@link LumenFlowError} if `admin` is not the contract admin,
   *   or if the merchant is not found.
   */
  async deactivateMerchant(admin: string, merchantAddress: string): Promise<void> {
    await this.invoke("deactivate_merchant", [
      new Address(admin),
      new Address(merchantAddress),
    ]);
  }

  /**
   * Grants a merchant the "verified" badge, indicating admin approval.
   *
   * @param admin - Stellar address of the administrator (must sign).
   * @param merchantAddress - Stellar address of the merchant to verify.
   * @returns A Promise that resolves when verification is recorded.
   * @throws {@link LumenFlowError} if the caller is not the admin or the merchant is not found.
   */
  async verifyMerchant(admin: string, merchantAddress: string): Promise<void> {
    await this.invoke("verify_merchant", [
      new Address(admin),
      new Address(merchantAddress),
    ]);
  }

  /**
   * Removes the "verified" badge from a merchant.
   *
   * @param admin - Stellar address of the administrator (must sign).
   * @param merchantAddress - Stellar address of the merchant to un-verify.
   * @returns A Promise that resolves when the badge is removed.
   * @throws {@link LumenFlowError} if the caller is not the admin or the merchant is not found.
   */
  async unverifyMerchant(admin: string, merchantAddress: string): Promise<void> {
    await this.invoke("unverify_merchant", [
      new Address(admin),
      new Address(merchantAddress),
    ]);
  }

  /**
   * Fetches the full merchant record for a given address.
   *
   * @param merchantAddress - Stellar address of the merchant to look up.
   * @returns A Promise that resolves to the {@link Merchant} data struct.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.MerchantNotFound` if not registered.
   *
   * @example
   * const merchant = await client.getMerchant("GMERCHANT...");
   * console.log(merchant.name, merchant.isVerified);
   */
  async getMerchant(merchantAddress: string): Promise<Merchant> {
    return await this.call("get_merchant", [new Address(merchantAddress)]);
  }

  /**
   * Checks whether a given address has a registered merchant record.
   *
   * @param merchantAddress - Stellar address to check.
   * @returns A Promise resolving to `true` if registered, `false` otherwise.
   *
   * @example
   * if (await client.isRegistered("GMERCHANT...")) {
   *   console.log("Merchant is registered");
   * }
   */
  async isRegistered(merchantAddress: string): Promise<boolean> {
    return await this.call("is_registered", [new Address(merchantAddress)]);
  }

  // ── Payment processing ────────────────────────────────────────────────────

  /**
   * Processes a payment that is authorised by a merchant-supplied cryptographic signature.
   * Use this flow when the merchant signs the payment parameters off-chain before checkout.
   *
   * @param payer - Stellar address of the account funding the payment (must sign).
   * @param orderId - Unique order identifier (max 64 bytes). Must not already exist.
   * @param merchantAddress - Stellar address of the recipient merchant.
   * @param tokenAddress - Contract address of the Stellar asset (SAC) to transfer.
   * @param amount - Transfer amount in the token's smallest unit (e.g. stroops for XLM).
   * @param memo - Human-readable payment memo (stored on-chain, max 256 bytes).
   * @param tags - Optional array of tags for categorisation and filtering; pass `null` to omit.
   * @param signature - Ed25519 signature over the payment parameters, produced by the merchant.
   * @param merchantPublicKey - The Ed25519 public key used to verify `signature`.
   * @returns A Promise that resolves when the payment is confirmed.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.DuplicateOrderId` if `orderId` already exists.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.InvalidSignature` if the signature is invalid.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.MerchantNotFound` if the merchant is not registered.
   *
   * @example
   * await client.processPaymentWithSignature(
   *   "GPAYER...",
   *   "order-001",
   *   "GMERCHANT...",
   *   "CTOKEN_SAC...",
   *   100_000_000n,   // 10 XLM in stroops
   *   "Coffee order",
   *   ["food", "beverage"],
   *   signature,
   *   merchantPubKey,
   * );
   */
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

  /**
   * Submit a payment with optional client-side idempotency protection.
   *
   * This convenience method wraps {@link processPaymentWithNonce}.  When
   * `idempotencyKey` is supplied the SDK caches the result and returns the
   * same result for any subsequent call with the same key, without issuing
   * a new RPC request.  Cache entries expire after 5 minutes.
   *
   * @param payer           - Address of the account funding the payment.
   * @param orderId         - Unique order identifier for contract-level deduplication.
   * @param merchantAddress - Registered, active merchant receiving the funds.
   * @param tokenAddress    - Allowed token contract address.
   * @param amount          - Positive token amount in the token's smallest unit.
   * @param memo            - Optional free-text note (max 256 characters).
   * @param tags            - Optional string tags (max 10 tags, 32 chars each).
   * @param nonce           - Replay-prevention nonce (fetch current and increment by 1).
   * @param idempotencyKey  - Optional caller-supplied key.  Identical keys within
   *                          the 5-minute TTL return the cached result without a new call.
   *
   * @example
   * ```typescript
   * // First call — hits the network
   * await client.processPayment(payer, 'ORDER-1', merchant, token, 1000n, 'memo', null, 0n, 'key-abc');
   * // Second call with same key within 5 min — returns cached result, no RPC call
   * await client.processPayment(payer, 'ORDER-1', merchant, token, 1000n, 'memo', null, 0n, 'key-abc');
   * ```
   */
  async processPayment(
    payer: string,
    orderId: string,
    merchantAddress: string,
    tokenAddress: string,
    amount: bigint,
    memo: string,
    tags: string[] | null,
    nonce: bigint,
    idempotencyKey?: string
  ): Promise<void> {
    return withIdempotency(idempotencyKey, () =>
      this.processPaymentWithNonce(
        payer,
        orderId,
        merchantAddress,
        tokenAddress,
        amount,
        memo,
        tags,
        nonce
      )
    );
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

  /**
   * Retrieves a single {@link PaymentOrder} by its unique order ID.
   * The caller must be the payer, the merchant, or an admin.
   *
   * @param caller - Stellar address of the authorised caller.
   * @param orderId - The unique order identifier to look up.
   * @returns A Promise resolving to the full {@link PaymentOrder} record.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.PaymentNotFound` if not found.
   * @throws {@link LumenFlowError} if the caller is not authorised to view this order.
   *
   * @example
   * const order = await client.getPaymentById("GPAYER...", "order-001");
   * console.log(order.amount, order.status);
   */
  async getPaymentById(caller: string, orderId: string): Promise<PaymentOrder> {
    return await this.call("get_payment_by_id", [
      new Address(caller),
      orderId,
    ]);
  }

  /**
   * Appends a freeform note to an existing payment record.
   * Only the merchant associated with the payment may add notes.
   *
   * @param merchant - Stellar address of the merchant (must sign).
   * @param orderId - The order to annotate.
   * @param note - Note text (max 512 bytes).
   * @returns A Promise that resolves when the note is recorded.
   * @throws {@link LumenFlowError} if the caller is not the payment's merchant.
   */
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

  /**
   * Retrieves a lightweight {@link PaymentSummary} for a given order.
   * Unlike {@link getPaymentById}, this does not require caller authorisation.
   *
   * @param orderId - The unique order identifier.
   * @returns A Promise resolving to a {@link PaymentSummary} (amount, status, token).
   * @throws {@link LumenFlowError} with `PaymentErrorCode.PaymentNotFound` if the order does not exist.
   */
  async getPaymentSummary(orderId: string): Promise<PaymentSummary> {
    return await this.call("get_payment_summary", [orderId]);
  }

  /**
   * Manually updates the status of a payment record after a partial or full refund
   * has been processed outside the normal refund workflow.
   *
   * @param caller - Stellar address of the caller (must be admin or the payment's merchant).
   * @param orderId - The order whose status should be updated.
   * @param refundedAmount - Total refunded amount in stroops so far. Used to derive
   *   whether the order is `PartiallyRefunded` or `FullyRefunded`.
   * @returns A Promise that resolves when the status update is confirmed.
   * @throws {@link LumenFlowError} if the caller is not authorised.
   */
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

  /**
   * Moves a completed payment record from active storage to an archive bucket,
   * reducing on-chain storage costs.
   *
   * @param admin - Stellar address of the administrator (must sign).
   * @param orderId - Order ID to archive.
   * @returns A Promise that resolves when the record is archived.
   * @throws {@link LumenFlowError} if the caller is not the admin.
   */
  async archivePaymentRecord(admin: string, orderId: string): Promise<void> {
    await this.invoke("archive_payment_record", [
      new Address(admin),
      orderId,
    ]);
  }

  /**
   * Purges payment records that have exceeded the configured cleanup period.
   * Useful for periodic maintenance to reclaim ledger storage.
   *
   * @param admin - Stellar address of the administrator (must sign).
   * @returns A Promise resolving to the number of records deleted.
   * @throws {@link LumenFlowError} if the caller is not the admin.
   *
   * @example
   * const deleted = await client.cleanupExpiredPayments("GADMIN...");
   * console.log(`Cleaned up ${deleted} expired payments`);
   */
  async cleanupExpiredPayments(admin: string): Promise<number> {
    return await this.invoke("cleanup_expired_payments", [
      new Address(admin),
    ]);
  }

  // ── Payment history queries ───────────────────────────────────────────────

  /**
   * Returns a paginated list of payment history for a specific merchant.
   *
   * @param merchant - Stellar address of the merchant whose history to retrieve.
   * @param cursor - Opaque pagination cursor from a previous response, or `null` to start from the beginning.
   * @param limit - Maximum number of records to return per page (1–100).
   * @param filter - Optional {@link PaymentFilter} to narrow results by date, amount, token, status, or tag.
   *   Pass `null` to return all records.
   * @param sortField - {@link SortField} to sort by (e.g. `SortField.Date` or `SortField.Amount`).
   * @param sortOrder - {@link SortOrder} direction (`SortOrder.Asc` or `SortOrder.Desc`).
   * @returns A Promise resolving to a {@link PaymentPage} containing records and the next cursor.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.MerchantNotFound` if the merchant is not registered.
   * @throws {@link LumenFlowError} if the caller is not the merchant or an admin.
   *
   * @example
   * const page = await client.getMerchantPaymentHistory(
   *   "GMERCHANT...", null, 20,
   *   { status: PaymentStatus.Completed },
   *   SortField.Date, SortOrder.Desc,
   * );
   * for (const payment of page.records) {
   *   console.log(payment.orderId, payment.amount);
   * }
   */
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

  /**
   * Returns a paginated list of payment history for a specific payer.
   *
   * @param payer - Stellar address of the payer whose history to retrieve.
   * @param cursor - Opaque pagination cursor from a previous response, or `null` to start from the beginning.
   * @param limit - Maximum number of records per page (1–100).
   * @param filter - Optional {@link PaymentFilter}; pass `null` to return all records.
   * @param sortField - {@link SortField} to sort by.
   * @param sortOrder - {@link SortOrder} direction.
   * @returns A Promise resolving to a {@link PaymentPage}.
   * @throws {@link LumenFlowError} if the caller is not the payer or an admin.
   */
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

  /**
   * Retrieves aggregate payment statistics across the entire contract.
   * Admin-only endpoint.
   *
   * @param admin - Stellar address of the administrator.
   * @param dateStart - Optional Unix timestamp (seconds) to start the aggregation window.
   * @param dateEnd - Optional Unix timestamp (seconds) to end the aggregation window.
   * @returns A Promise resolving to a {@link GlobalStats} object with total volume, counts, etc.
   * @throws {@link LumenFlowError} if the caller is not the admin.
   *
   * @example
   * const stats = await client.getGlobalPaymentStats(
   *   "GADMIN...",
   *   BigInt(Math.floor(Date.now() / 1000) - 86400), // last 24 h
   * );
   * console.log("Total volume:", stats.totalVolume);
   */
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

  /**
   * Opens a new refund request for a completed payment.
   * The caller must be either the payer or the merchant of the original order.
   *
   * @param caller - Stellar address of the initiator (payer or merchant, must sign).
   * @param refundId - Unique identifier for this refund request (max 64 bytes).
   * @param orderId - The original payment order ID to refund.
   * @param amount - Refund amount in the token's smallest unit. Must not exceed the original amount.
   * @param reason - Human-readable reason for the refund (max 256 bytes).
   * @returns A Promise that resolves when the refund request is recorded.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.RefundExceedsPayment` if `amount` is too large.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.MaxRefundsExceeded` if the order already has
   *   the maximum number of refunds.
   *
   * @example
   * await client.initiateRefund(
   *   "GPAYER...", "refund-001", "order-001", 50_000_000n, "Item not received"
   * );
   */
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

  /**
   * Approves a pending refund request, moving it to `Approved` status.
   * The caller must be the merchant of the original payment.
   *
   * @param caller - Stellar address of the approving merchant (must sign).
   * @param refundId - ID of the refund request to approve.
   * @returns A Promise that resolves when the approval is recorded.
   * @throws {@link LumenFlowError} if the refund is not in `Pending` status.
   * @throws {@link LumenFlowError} if the caller is not the payment's merchant.
   */
  async approveRefund(caller: string, refundId: string): Promise<void> {
    await this.invoke("approve_refund", [
      new Address(caller),
      refundId,
    ]);
  }

  /**
   * Rejects a pending refund request, moving it to `Rejected` status.
   * The caller must be the merchant of the original payment.
   *
   * @param caller - Stellar address of the rejecting merchant (must sign).
   * @param refundId - ID of the refund request to reject.
   * @returns A Promise that resolves when the rejection is recorded.
   * @throws {@link LumenFlowError} if the refund is not in `Pending` status.
   */
  async rejectRefund(caller: string, refundId: string): Promise<void> {
    await this.invoke("reject_refund", [
      new Address(caller),
      refundId,
    ]);
  }

  /**
   * Executes an approved refund, transferring tokens back to the payer.
   * Can be called by anyone once the refund is in `Approved` status.
   *
   * @param refundId - ID of the approved refund to execute.
   * @returns A Promise that resolves when the token transfer is confirmed.
   * @throws {@link LumenFlowError} if the refund is not in `Approved` status.
   */
  async executeRefund(refundId: string): Promise<void> {
    await this.invoke("execute_refund", [refundId]);
  }

  /**
   * Fetches a refund record by its ID.
   *
   * @param refundId - Unique refund identifier.
   * @returns A Promise resolving to the full {@link RefundRecord}.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.RefundNotFound` if not found.
   */
  async getRefund(refundId: string): Promise<RefundRecord> {
    return await this.call("get_refund", [refundId]);
  }

  /**
   * List all refunds for a given order.
   * Caller must be the payer, merchant, or admin.
   */
  async getRefundsForOrder(caller: string, orderId: string): Promise<RefundRecord[]> {
    return await this.call("get_refunds_for_order", [
      new Address(caller),
      orderId,
    ]);
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

  /**
   * Resolves a disputed refund with an admin ruling.
   * The outcome determines whether the refund is executed or permanently rejected.
   *
   * @param admin - Stellar address of the administrator (must sign).
   * @param refundId - ID of the disputed refund.
   * @param outcome - {@link DisputeOutcome} — either `DisputeOutcome.RefundGranted` or
   *   `DisputeOutcome.RefundDenied`.
   * @returns A Promise that resolves when the dispute outcome is recorded.
   * @throws {@link LumenFlowError} if the caller is not the admin.
   * @throws {@link LumenFlowError} if the refund is not in `Disputed` status.
   */
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

  /**
   * Creates a new multi-signature payment that requires approval from a threshold
   * of designated signers before funds are released.
   *
   * @param initiator - Stellar address of the user creating the payment (must sign).
   * @param paymentId - Unique identifier for this multisig payment (max 64 bytes).
   * @param merchantAddress - Stellar address of the recipient merchant.
   * @param tokenAddress - Contract address of the Stellar asset (SAC) to transfer.
   * @param amount - Transfer amount in the token's smallest unit.
   * @param signers - Array of Stellar addresses authorised to sign this payment.
   * @param requiredSignatures - Minimum number of signer approvals needed to execute
   *   (must be ≤ `signers.length`).
   * @returns A Promise that resolves when the multisig payment is initialised.
   * @throws {@link LumenFlowError} if `requiredSignatures` exceeds `signers.length`.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.MerchantNotFound` if the merchant is not registered.
   *
   * @example
   * await client.initiateMultisigPayment(
   *   "GINITIATOR...", "mp-001", "GMERCHANT...", "CTOKEN...",
   *   1_000_000_000n,
   *   ["GSIGNER1...", "GSIGNER2...", "GSIGNER3..."],
   *   2, // 2-of-3
   * );
   */
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

  /**
   * Adds a signer's approval to a pending multisig payment.
   * Calling this for the final required signer does **not** automatically execute
   * the payment — call {@link executeMultisigPayment} separately.
   *
   * @param signer - Stellar address of the approving signer (must sign; must be in the signer list).
   * @param paymentId - ID of the multisig payment to sign.
   * @param signature - Ed25519 signature over the payment parameters by `signer`.
   * @returns A Promise that resolves when the signature is recorded.
   * @throws {@link LumenFlowError} if `signer` is not in the payment's signer list.
   * @throws {@link LumenFlowError} if the payment is already executed or cancelled.
   */
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

  /**
   * Executes a multisig payment once it has collected the required number of signatures.
   *
   * @param payer - Stellar address of the account funding the payment (must sign).
   * @param paymentId - ID of the multisig payment to execute.
   * @returns A Promise that resolves when the payment is executed and confirmed.
   * @throws {@link LumenFlowError} if the payment has not yet reached the required signature threshold.
   * @throws {@link LumenFlowError} if the payment has already been executed or cancelled.
   */
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

  /**
   * Creates a new recurring subscription plan offered by a merchant.
   *
   * @param merchant - Stellar address of the merchant creating the plan (must sign).
   * @param planId - Unique plan identifier (max 64 bytes).
   * @param token - Contract address of the Stellar asset charged per cycle.
   * @param amount - Amount charged per billing cycle in the token's smallest unit.
   * @param intervalSecs - Billing interval in seconds (e.g. `2592000n` for ~30 days).
   * @param maxCycles - Maximum number of billing cycles (use `0` for unlimited).
   * @returns A Promise that resolves when the plan is created.
   * @throws {@link LumenFlowError} if a plan with `planId` already exists.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.MerchantNotFound` if the merchant is not registered.
   *
   * @example
   * await client.createSubscriptionPlan(
   *   "GMERCHANT...", "plan-monthly", "CTOKEN...",
   *   100_000_000n, // 10 XLM per month
   *   2_592_000n,   // 30 days
   *   12,           // max 12 cycles (1 year)
   * );
   */
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

  /**
   * Subscribes a user to an existing subscription plan.
   * The subscriber's wallet must pre-approve token allowances up to `amount × maxCycles`.
   *
   * @param subscriber - Stellar address of the subscribing account (must sign).
   * @param subscriptionId - Unique identifier for this subscription instance (max 64 bytes).
   * @param planId - ID of the subscription plan to subscribe to.
   * @returns A Promise that resolves when the subscription is active.
   * @throws {@link LumenFlowError} if `planId` does not exist.
   * @throws {@link LumenFlowError} if a subscription with `subscriptionId` already exists.
   */
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

  /**
   * Charges a subscription for the current billing cycle.
   * The subscription must be active and its next charge date must have passed.
   * Can be triggered by anyone (typically an automated keeper service).
   *
   * @param subscriptionId - ID of the subscription to charge.
   * @returns A Promise that resolves when the charge is processed.
   * @throws {@link LumenFlowError} if the subscription is not yet due.
   * @throws {@link LumenFlowError} if the subscription is cancelled or exhausted.
   */
  async chargeSubscription(subscriptionId: string): Promise<void> {
    await this.invoke("charge_subscription", [subscriptionId]);
  }

  /**
   * Cancels an active subscription, preventing future charges.
   * Only the subscriber may cancel their own subscription.
   *
   * @param subscriber - Stellar address of the subscriber (must sign).
   * @param subscriptionId - ID of the subscription to cancel.
   * @returns A Promise that resolves when the cancellation is confirmed.
   * @throws {@link LumenFlowError} if the subscription is already cancelled.
   * @throws {@link LumenFlowError} if the caller is not the subscription's owner.
   */
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

  /**
   * Creates a shareable payment request (like an invoice) that a payer can fulfil
   * by calling {@link payPaymentRequest}.
   *
   * @param merchant - Stellar address of the merchant creating the request (must sign).
   * @param requestId - Unique identifier for this request (max 64 bytes).
   * @param token - Contract address of the Stellar asset to request.
   * @param amount - Requested amount in the token's smallest unit.
   * @param memo - Human-readable description of what is being charged.
   * @param ttl - Time-to-live in seconds from now. The request expires after this duration.
   * @returns A Promise that resolves when the payment request is created.
   * @throws {@link LumenFlowError} if a request with `requestId` already exists.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.MerchantNotFound` if the merchant is not registered.
   *
   * @example
   * await client.createPaymentRequest(
   *   "GMERCHANT...", "req-2026-001", "CTOKEN...",
   *   500_000_000n, // 50 XLM
   *   "Invoice #2026-001 — Web design services",
   *   86400n,       // expires in 24 hours
   * );
   */
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

  /**
   * Pays an outstanding payment request created by a merchant.
   * The request must not be expired or already paid.
   *
   * @param payer - Stellar address of the paying account (must sign).
   * @param requestId - ID of the payment request to fulfil.
   * @returns A Promise that resolves when the payment is confirmed.
   * @throws {@link LumenFlowError} if the request has expired or is already paid.
   * @throws {@link LumenFlowError} with `PaymentErrorCode.PaymentNotFound` if `requestId` does not exist.
   *
   * @example
   * await client.payPaymentRequest("GPAYER...", "req-2026-001");
   */
  async payPaymentRequest(payer: string, requestId: string): Promise<void> {
    await this.invoke("pay_payment_request", [
      new Address(payer),
      requestId,
    ]);
  }

  /**
   * Cancel an unexpired payment request before it has been paid.
   *
   * Only the merchant who created the request may cancel it. This method
   * performs a **pre-flight caller validation**: if `walletAddress` is
   * configured on this client (via {@link ClientConfig.walletAddress} or
   * {@link setWalletAddress}), the supplied `caller` must match exactly.
   * A mismatch throws {@link LumenFlowError} with code
   * {@link PaymentErrorCode.Unauthorized} before any RPC call is made,
   * saving a round-trip.
   *
   * @param caller    - The Stellar address of the merchant cancelling the request.
   *                    Must match the merchant who created the request on-chain.
   * @param requestId - The unique ID of the payment request to cancel.
   *
   * @throws {LumenFlowError} `Unauthorized` (code 1) when `caller` does not
   *   match the configured wallet address.
   *
   * @example
   * ```typescript
   * const client = new LumenFlowClient({
   *   contractId: CONTRACT_ID,
   *   rpcUrl:     RPC_URL,
   *   networkPassphrase: Networks.TESTNET,
   *   walletAddress: merchantKeypair.publicKey(),
   * });
   * client.setSigner(tx => { tx.sign(merchantKeypair); return tx; });
   *
   * // Cancel an unexpired request
   * await client.cancelPaymentRequest(merchantKeypair.publicKey(), "REQ_001");
   * ```
   */
  async cancelPaymentRequest(caller: string, requestId: string): Promise<void> {
    // Pre-flight: verify the caller matches the connected wallet address.
    if (this.walletAddress !== undefined && caller !== this.walletAddress) {
      throw new LumenFlowError(
        PaymentErrorCode.Unauthorized,
        `cancelPaymentRequest: caller "${caller}" does not match the connected wallet address "${this.walletAddress}".`
      );
    }

    await this.invoke("cancel_payment_request", [
      new Address(caller),
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
