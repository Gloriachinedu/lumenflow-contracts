import { Client, ClientConfig } from './client';
import { LumenFlowError } from './errors';

describe('Client', () => {
  describe('retry behavior', () => {
    it('should retry 503 errors up to maxAttempts times', async () => {
      const config: ClientConfig = {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        contractId: 'test-contract-id',
        retryConfig: {
          maxAttempts: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
          jitterFactor: 0,
        },
      };

      const client = new Client(config);

      // Mock executeInvoke to throw 503 errors
      let attemptCount = 0;
      jest.spyOn(client as any, 'executeInvoke').mockImplementation(async () => {
        attemptCount++;
        const error: any = new Error('Service Unavailable');
        error.response = { status: 503 };
        throw error;
      });

      await expect(client.invoke('testMethod')).rejects.toThrow();

      // Should have attempted maxAttempts times
      expect(attemptCount).toBe(3);
    });

    it('should succeed on retry after transient error', async () => {
      const config: ClientConfig = {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        contractId: 'test-contract-id',
        retryConfig: {
          maxAttempts: 3,
          initialDelayMs: 10,
          maxDelayMs: 100,
          backoffMultiplier: 2,
          jitterFactor: 0,
        },
      };

      const client = new Client(config);

      // Mock executeInvoke to fail once then succeed
      let attemptCount = 0;
      jest.spyOn(client as any, 'executeInvoke').mockImplementation(async () => {
        attemptCount++;
        if (attemptCount === 1) {
          const error: any = new Error('Service Unavailable');
          error.response = { status: 503 };
          throw error;
        }
        return { success: true };
      });

      const result = await client.invoke('testMethod');

      expect(result).toEqual({ success: true });
      expect(attemptCount).toBe(2);
    });

    it('should not retry non-retryable errors', async () => {
      const config: ClientConfig = {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        contractId: 'test-contract-id',
        retryConfig: {
          maxAttempts: 3,
          initialDelayMs: 10,
        },
      };

      const client = new Client(config);

      let attemptCount = 0;
      jest.spyOn(client as any, 'executeInvoke').mockImplementation(async () => {
        attemptCount++;
        const error: any = new Error('Bad Request');
        error.response = { status: 400 };
        throw error;
      });

      await expect(client.invoke('testMethod')).rejects.toThrow();

      // Should only attempt once (no retry for 400)
      expect(attemptCount).toBe(1);
    });
  });

  describe('LumenFlowError propagation', () => {
    it('should not retry LumenFlowError (business logic errors)', async () => {
      const config: ClientConfig = {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        contractId: 'test-contract-id',
        retryConfig: {
          maxAttempts: 3,
          initialDelayMs: 10,
        },
      };

      const client = new Client(config);

      let attemptCount = 0;
      jest.spyOn(client as any, 'executeInvoke').mockImplementation(async () => {
        attemptCount++;
        throw new LumenFlowError(50); // PaymentAlreadyExists
      });

      await expect(client.invoke('testMethod')).rejects.toThrow(LumenFlowError);

      // Should only attempt once (no retry for business logic errors)
      expect(attemptCount).toBe(1);
    });
  });

  describe('configuration', () => {
    it('should use default retry config when not provided', () => {
      const config: ClientConfig = {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        contractId: 'test-contract-id',
      };

      const client = new Client(config);
      const retryConfig = client.getRetryConfig();

      expect(retryConfig.maxAttempts).toBe(5);
      expect(retryConfig.initialDelayMs).toBe(100);
      expect(retryConfig.maxDelayMs).toBe(10000);
    });

    it('should merge custom retry config with defaults', () => {
      const config: ClientConfig = {
        rpcUrl: 'https://soroban-testnet.stellar.org',
        contractId: 'test-contract-id',
        retryConfig: {
          maxAttempts: 10,
        },
      };

      const client = new Client(config);
      const retryConfig = client.getRetryConfig();

      expect(retryConfig.maxAttempts).toBe(10);
      expect(retryConfig.initialDelayMs).toBe(100); // default
      expect(retryConfig.maxDelayMs).toBe(10000); // default
    });
  });
});
