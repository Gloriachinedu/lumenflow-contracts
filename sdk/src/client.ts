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
