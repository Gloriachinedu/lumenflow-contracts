import { Client, ClientConfig } from './client';
import { LumenFlowError } from './errors';

// Mock the event poller module so subscribe() can be tested without real polling.
jest.mock('./eventPoller', () => {
  return {
    EventPoller: jest.fn().mockImplementation(() => {
      return {
        start: jest.fn(),
        stop: jest.fn(),
      };
    }),
  };
});

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

  describe('subscribe', () => {
    const baseConfig: ClientConfig = {
      rpcUrl: 'https://soroban-testnet.stellar.org',
      contractId: 'test-contract-id',
    };

    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      jest.clearAllMocks();
    });

    it('should call handler with a typed payload when an event is polled', async () => {
      const client = new Client(baseConfig);
      const handler = jest.fn();

      // Simulate the poller delivering a decoded (typed) event payload.
      const typedEvent = { type: 'payment_created', paymentId: 'p-1', amount: '100' };
      jest
        .spyOn(client as any, 'pollEvents')
        .mockResolvedValue([typedEvent]);

      const unsubscribe = client.subscribe('payment_created', handler);

      // Advance one polling interval (default 5s) and flush pending promises.
      await jest.advanceTimersByTimeAsync(5000);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(typedEvent);

      unsubscribe();
    });

    it('should stop calling handler and clear the interval after unsubscribe', async () => {
      const client = new Client(baseConfig);
      const handler = jest.fn();

      const typedEvent = { type: 'payment_created', paymentId: 'p-1' };
      jest
        .spyOn(client as any, 'pollEvents')
        .mockResolvedValue([typedEvent]);

      const unsubscribe = client.subscribe('payment_created', handler);

      await jest.advanceTimersByTimeAsync(5000);
      expect(handler).toHaveBeenCalledTimes(1);

      unsubscribe();

      // No further handler calls after unsubscribing.
      await jest.advanceTimersByTimeAsync(20000);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('should not crash the poller when the handler throws', async () => {
      const client = new Client(baseConfig);
      const handler = jest.fn(() => {
        throw new Error('handler boom');
      });

      const firstEvent = { type: 'payment_created', paymentId: 'p-1' };
      const secondEvent = { type: 'payment_created', paymentId: 'p-2' };
      jest
        .spyOn(client as any, 'pollEvents')
        .mockResolvedValueOnce([firstEvent])
        .mockResolvedValueOnce([secondEvent]);

      const unsubscribe = client.subscribe('payment_created', handler);

      // First poll: handler throws but poller keeps running.
      await jest.advanceTimersByTimeAsync(5000);
      expect(handler).toHaveBeenCalledTimes(1);

      // Second poll: subsequent event is still delivered.
      await jest.advanceTimersByTimeAsync(5000);
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenLastCalledWith(secondEvent);

      unsubscribe();
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
