import {
  Contract,
  SorobanRpc,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  Keypair,
  nativeToScVal,
  Address,
  xdr,
  scValToNative,
} from "@stellar/stellar-sdk";
import { LumenFlowError, PaymentErrorCode } from "./errors";

export interface LumenFlowClientConfig {
  /** Deployed contract address */
  contractId: string;
  /** Soroban RPC endpoint URL */
  rpcUrl: string;
  /** Stellar network passphrase */
  networkPassphrase: string;
}

/** Presets for common networks */
export const NETWORKS = {
  mainnet: {
    rpcUrl: "https://soroban-mainnet.stellar.org",
    networkPassphrase: Networks.PUBLIC,
  },
  testnet: {
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: Networks.TESTNET,
  },
} as const;

/** Raw result from a simulation or send */
export interface InvokeResult<T = unknown> {
  result: T;
  /** Ledger fee consumed (simulation estimate) */
  fee?: string;
}

/**
 * LumenFlowClient wraps the LumenFlow Soroban contract for Node.js / serverless
 * environments. It provides:
 *   - `query` — read-only simulation, no signing required
 *   - `invoke` — state-changing call, requires a `Keypair` source account
 */
export class LumenFlowClient {
  private readonly rpc: SorobanRpc.Server;
  private readonly contract: Contract;
  private readonly config: LumenFlowClientConfig;

  constructor(config: LumenFlowClientConfig) {
    this.config = config;
    this.rpc = new SorobanRpc.Server(config.rpcUrl, { allowHttp: config.rpcUrl.startsWith("http://") });
    this.contract = new Contract(config.contractId);
  }

  // ── Read-only helpers ────────────────────────────────────────────────────

  /**
   * Simulate a contract call and return the decoded result without submitting
   * a transaction (no fees, no auth required).
   */
  async query<T = unknown>(method: string, ...args: xdr.ScVal[]): Promise<T> {
    const account = await this.rpc.getAccount(
      // Use a well-known funded testnet account for simulation-only calls
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
    ).catch(() => {
      // Fall back to a dummy account object for simulation
      return { accountId: () => "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", sequenceNumber: () => "0", incrementSequenceNumber: () => {} } as any;
    });

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simulation = await this.rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw this._parseError(simulation.error);
    }
    if (!SorobanRpc.Api.isSimulationSuccess(simulation)) {
      throw new Error("Simulation did not succeed");
    }

    const resultVal = simulation.result?.retval;
    return resultVal ? (scValToNative(resultVal) as T) : (undefined as T);
  }

  /**
   * Build, sign, submit and await a state-changing contract call.
   */
  async invoke<T = unknown>(
    source: Keypair,
    method: string,
    ...args: xdr.ScVal[]
  ): Promise<InvokeResult<T>> {
    const account = await this.rpc.getAccount(source.publicKey());

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.config.networkPassphrase,
    })
      .addOperation(this.contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const simulation = await this.rpc.simulateTransaction(tx);
    if (SorobanRpc.Api.isSimulationError(simulation)) {
      throw this._parseError(simulation.error);
    }
    if (!SorobanRpc.Api.isSimulationSuccess(simulation)) {
      throw new Error("Simulation failed before submission");
    }

    const prepared = SorobanRpc.assembleTransaction(tx, simulation).build();
    prepared.sign(source);

    const sendResponse = await this.rpc.sendTransaction(prepared);
    if (sendResponse.status === "ERROR") {
      throw new Error(`Transaction submission failed: ${sendResponse.errorResult?.toXDR("base64")}`);
    }

    // Poll for confirmation
    let getResponse = await this.rpc.getTransaction(sendResponse.hash);
    for (let i = 0; i < 20 && getResponse.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      getResponse = await this.rpc.getTransaction(sendResponse.hash);
    }

    if (getResponse.status !== SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      throw new Error(`Transaction failed with status: ${getResponse.status}`);
    }

    const resultVal = getResponse.returnValue;
    const result = resultVal ? (scValToNative(resultVal) as T) : (undefined as T);
    return { result, fee: simulation.minResourceFee };
  }

  // ── Contract-specific helpers ────────────────────────────────────────────

  /** Check if a merchant address is registered (read-only). */
  async isRegistered(merchantAddress: string): Promise<boolean> {
    return this.query<boolean>("is_registered", new Address(merchantAddress).toScVal());
  }

  /** Get merchant details (read-only). */
  async getMerchant(merchantAddress: string): Promise<Record<string, unknown>> {
    return this.query<Record<string, unknown>>("get_merchant", new Address(merchantAddress).toScVal());
  }

  /** Get a public payment summary by order ID (read-only). */
  async getPaymentSummary(orderId: string): Promise<Record<string, unknown>> {
    return this.query<Record<string, unknown>>("get_payment_summary", nativeToScVal(orderId, { type: "string" }));
  }

  /** Register a new merchant (invoke). */
  async registerMerchant(
    source: Keypair,
    merchantAddress: string,
    name: string,
    description: string,
    contactInfo: string,
    category: string
  ): Promise<InvokeResult<void>> {
    return this.invoke<void>(
      source,
      "register_merchant",
      new Address(merchantAddress).toScVal(),
      nativeToScVal(name, { type: "string" }),
      nativeToScVal(description, { type: "string" }),
      nativeToScVal(contactInfo, { type: "string" }),
      nativeToScVal(category, { type: "symbol" })
    );
  }

  /** Process a payment with an ed25519 signature (invoke). */
  async processPayment(
    source: Keypair,
    params: {
      payer: string;
      orderId: string;
      merchantAddress: string;
      tokenAddress: string;
      amount: bigint;
      memo: string;
      signature: Buffer;
      merchantPublicKey: Buffer;
    }
  ): Promise<InvokeResult<void>> {
    return this.invoke<void>(
      source,
      "process_payment_with_signature",
      new Address(params.payer).toScVal(),
      nativeToScVal(params.orderId, { type: "string" }),
      new Address(params.merchantAddress).toScVal(),
      new Address(params.tokenAddress).toScVal(),
      nativeToScVal(params.amount, { type: "i128" }),
      nativeToScVal(params.memo, { type: "string" }),
      nativeToScVal(null),
      nativeToScVal(params.signature),
      nativeToScVal(params.merchantPublicKey)
    );
  }

  // ── Internal ─────────────────────────────────────────────────────────────

  private _parseError(message: string): LumenFlowError | Error {
    // Contract errors surface as "Error(Contract, <code>)" in simulation output
    const match = message.match(/Error\(Contract,\s*#(\d+)\)/);
    if (match) {
      const code = parseInt(match[1], 10) as PaymentErrorCode;
      return new LumenFlowError(code, message);
    }
    return new Error(message);
  }
}
