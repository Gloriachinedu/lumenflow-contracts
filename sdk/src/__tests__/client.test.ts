/**
 * Integration tests for LumenFlowClient.
 *
 * These tests mock the Soroban RPC layer so they run without a live node.
 * For end-to-end testing against testnet, set the environment variables:
 *   LUMENFLOW_CONTRACT_ID, LUMENFLOW_RPC_URL, LUMENFLOW_SOURCE_SECRET
 */

import { LumenFlowClient, NETWORKS, LumenFlowError, PaymentErrorCode } from "../index";
import { SorobanRpc, scValToNative, nativeToScVal, xdr } from "@stellar/stellar-sdk";

// ── Mock the Soroban RPC server ───────────────────────────────────────────────

const mockSimulateTransaction = jest.fn();
const mockGetAccount = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn().mockImplementation(() => ({
        simulateTransaction: mockSimulateTransaction,
        getAccount: mockGetAccount,
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction,
      })),
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSuccessSimulation(retval: xdr.ScVal) {
  return {
    result: { retval },
    minResourceFee: "100",
    _parsed: true,
  };
}

function makeAccount(publicKey: string) {
  return {
    accountId: () => publicKey,
    sequenceNumber: () => "1000",
    incrementSequenceNumber: jest.fn(),
  };
}

const TEST_CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const TEST_MERCHANT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";

function makeClient() {
  return new LumenFlowClient({
    contractId: TEST_CONTRACT_ID,
    rpcUrl: NETWORKS.testnet.rpcUrl,
    networkPassphrase: NETWORKS.testnet.networkPassphrase,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LumenFlowClient — read-only queries", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue(makeAccount(TEST_MERCHANT));
  });

  test("isRegistered returns true when contract returns true", async () => {
    mockSimulateTransaction.mockResolvedValue(
      makeSuccessSimulation(nativeToScVal(true))
    );

    const client = makeClient();
    const result = await client.isRegistered(TEST_MERCHANT);
    expect(result).toBe(true);
    expect(mockSimulateTransaction).toHaveBeenCalledTimes(1);
  });

  test("isRegistered returns false when contract returns false", async () => {
    mockSimulateTransaction.mockResolvedValue(
      makeSuccessSimulation(nativeToScVal(false))
    );

    const client = makeClient();
    const result = await client.isRegistered(TEST_MERCHANT);
    expect(result).toBe(false);
  });

  test("getMerchant returns decoded merchant object", async () => {
    const merchantData = {
      name: "Test Store",
      active: true,
      total_received: BigInt(1000),
    };
    mockSimulateTransaction.mockResolvedValue(
      makeSuccessSimulation(nativeToScVal(merchantData))
    );

    const client = makeClient();
    const merchant = await client.getMerchant(TEST_MERCHANT);
    expect(merchant).toMatchObject({ name: "Test Store", active: true });
  });

  test("query propagates simulation error as LumenFlowError for contract errors", async () => {
    mockSimulateTransaction.mockResolvedValue({
      error: "Error(Contract, #21)",
    });

    const client = makeClient();
    await expect(client.isRegistered(TEST_MERCHANT)).rejects.toBeInstanceOf(LumenFlowError);
  });

  test("query propagates simulation error as generic Error for non-contract errors", async () => {
    mockSimulateTransaction.mockResolvedValue({
      error: "HostError: value error",
    });

    const client = makeClient();
    await expect(client.isRegistered(TEST_MERCHANT)).rejects.toBeInstanceOf(Error);
  });
});

describe("LumenFlowClient — invoke calls", () => {
  const { Keypair } = jest.requireActual("@stellar/stellar-sdk");
  const source = Keypair.random();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue(makeAccount(source.publicKey()));
    mockSendTransaction.mockResolvedValue({
      hash: "abc123",
      status: "PENDING",
    });
    mockGetTransaction.mockResolvedValue({
      status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      returnValue: nativeToScVal(null),
    });
  });

  test("invoke submits and confirms a transaction", async () => {
    mockSimulateTransaction.mockResolvedValue(
      makeSuccessSimulation(nativeToScVal(null))
    );

    const client = makeClient();
    const result = await client.registerMerchant(
      source,
      source.publicKey(),
      "My Store",
      "A store",
      "contact@store.com",
      "Retail"
    );
    expect(result.result).toBeUndefined();
    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    expect(mockGetTransaction).toHaveBeenCalledTimes(1);
  });

  test("invoke throws LumenFlowError when simulation returns a contract error", async () => {
    mockSimulateTransaction.mockResolvedValue({
      error: "Error(Contract, #11)",
    });

    const client = makeClient();
    const err = await client
      .registerMerchant(source, source.publicKey(), "Store", "", "", "Other")
      .catch((e) => e);
    expect(err).toBeInstanceOf(LumenFlowError);
    expect((err as LumenFlowError).code).toBe(PaymentErrorCode.MerchantAlreadyRegistered);
  });

  test("invoke throws when transaction submission fails", async () => {
    mockSimulateTransaction.mockResolvedValue(
      makeSuccessSimulation(nativeToScVal(null))
    );
    mockSendTransaction.mockResolvedValue({
      status: "ERROR",
      errorResult: { toXDR: () => "base64-error" },
    });

    const client = makeClient();
    await expect(
      client.registerMerchant(source, source.publicKey(), "Store", "", "", "Other")
    ).rejects.toThrow("Transaction submission failed");
  });
});

describe("LumenFlowError", () => {
  test("maps known error code to message", () => {
    const err = new LumenFlowError(PaymentErrorCode.PaymentAlreadyExists);
    expect(err.message).toMatch(/order ID/i);
    expect(err.code).toBe(21);
  });

  test("provides a localization message key", () => {
    const err = new LumenFlowError(PaymentErrorCode.Unauthorized);
    expect(err.messageKey).toBe("error.unauthorized");
  });

  test("unknown error code produces fallback message", () => {
    const err = new LumenFlowError(999 as PaymentErrorCode);
    expect(err.message).toMatch(/unknown/i);
  });
});

describe("NETWORKS preset", () => {
  test("testnet preset has expected RPC url", () => {
    expect(NETWORKS.testnet.rpcUrl).toContain("testnet");
  });

  test("mainnet preset uses PUBLIC passphrase", () => {
    const { Networks } = jest.requireActual("@stellar/stellar-sdk");
    expect(NETWORKS.mainnet.networkPassphrase).toBe(Networks.PUBLIC);
  });
});
