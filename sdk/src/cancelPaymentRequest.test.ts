/**
 * Unit tests for LumenFlowClient.cancelPaymentRequest — issue #1361.
 *
 * Tests cover:
 *   - Success path: caller matches wallet, invoke is called with correct args
 *   - Caller-mismatch path: LumenFlowError(Unauthorized) thrown before RPC call
 *   - No-wallet path: no walletAddress configured, no pre-flight check
 */

import { LumenFlowClient, ClientConfig } from './client';
import { LumenFlowError, PaymentErrorCode } from './errors';

// Minimal Stellar-like address stubs (56-char G-addresses)
const MERCHANT = 'GCEZWKCA5VLDNRLN3RPRJMRZOX3Z6G5CHCGZTS1XHXE3PB48NLMQBQL';
const OTHER    = 'GBZXN7PIRZGNMHGA7N4YDAORJVFK4SDWQMKZP7TQFNHFBZ5VXXQ5JEM';

/**
 * Builds a minimal LumenFlowClient whose `invoke` private method is replaced
 * with a jest spy so no real RPC calls are made.
 */
function makeClient(walletAddress?: string): {
  client: LumenFlowClient;
  invokeSpy: jest.SpyInstance;
} {
  const config: ClientConfig = {
    contractId:        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    rpcUrl:            'https://soroban-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
    walletAddress,
  };

  const client = new LumenFlowClient(config);

  // Stub out the private `invoke` so we don't hit the network
  const invokeSpy = jest
    .spyOn(client as any, 'invoke')
    .mockResolvedValue(undefined);

  return { client, invokeSpy };
}

// ── Success path ──────────────────────────────────────────────────────────────

describe('cancelPaymentRequest — success', () => {
  it('calls invoke("cancel_payment_request") when caller matches wallet', async () => {
    const { client, invokeSpy } = makeClient(MERCHANT);

    await client.cancelPaymentRequest(MERCHANT, 'REQ_001');

    expect(invokeSpy).toHaveBeenCalledTimes(1);
    expect(invokeSpy).toHaveBeenCalledWith(
      'cancel_payment_request',
      expect.arrayContaining([
        expect.objectContaining({}), // Address(caller)
        'REQ_001',
      ])
    );
  });

  it('calls invoke when no walletAddress is configured (no pre-flight check)', async () => {
    // No walletAddress → validation is skipped entirely
    const { client, invokeSpy } = makeClient(undefined);

    await client.cancelPaymentRequest(MERCHANT, 'REQ_002');

    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });

  it('can cancel after setWalletAddress is called', async () => {
    const { client, invokeSpy } = makeClient(undefined);

    // Set wallet address after construction
    client.setWalletAddress(MERCHANT);
    await client.cancelPaymentRequest(MERCHANT, 'REQ_003');

    expect(invokeSpy).toHaveBeenCalledTimes(1);
  });
});

// ── Caller-mismatch path ──────────────────────────────────────────────────────

describe('cancelPaymentRequest — caller mismatch', () => {
  it('throws LumenFlowError(Unauthorized) when caller !== walletAddress', async () => {
    const { client, invokeSpy } = makeClient(MERCHANT);

    await expect(
      client.cancelPaymentRequest(OTHER, 'REQ_004')
    ).rejects.toThrow(LumenFlowError);

    await expect(
      client.cancelPaymentRequest(OTHER, 'REQ_004')
    ).rejects.toMatchObject({
      code: PaymentErrorCode.Unauthorized,
    });

    // invoke must NOT have been called — error is thrown pre-flight
    expect(invokeSpy).not.toHaveBeenCalled();
  });

  it('error codeName is "Unauthorized"', async () => {
    const { client } = makeClient(MERCHANT);

    let caught: LumenFlowError | undefined;
    try {
      await client.cancelPaymentRequest(OTHER, 'REQ_005');
    } catch (err) {
      caught = err as LumenFlowError;
    }

    expect(caught).toBeDefined();
    expect(caught!.codeName).toBe('Unauthorized');
  });

  it('throws immediately after setWalletAddress changes the address', async () => {
    const { client, invokeSpy } = makeClient(undefined);

    // First call without wallet: succeeds
    await client.cancelPaymentRequest(OTHER, 'REQ_006');
    expect(invokeSpy).toHaveBeenCalledTimes(1);

    // Set wallet to a different address
    client.setWalletAddress(MERCHANT);
    invokeSpy.mockClear();

    // Now caller !== walletAddress → must throw
    await expect(
      client.cancelPaymentRequest(OTHER, 'REQ_007')
    ).rejects.toThrow(LumenFlowError);
    expect(invokeSpy).not.toHaveBeenCalled();
  });
});
