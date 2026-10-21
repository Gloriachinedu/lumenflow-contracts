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

// ── serializeMerchantCategory ─────────────────────────────────────────────────

describe("serializeMerchantCategory", () => {
  const { serializeMerchantCategory } = require("../client");
  const { xdr, scValToNative } = jest.requireActual("@stellar/stellar-sdk");

  test("unit variant 'Retail' serializes to ScVec([ScSymbol('Retail')])", () => {
    const scVal = serializeMerchantCategory("Retail");
    expect(scVal.switch().name).toBe("scvVec");
    const vec = scVal.vec();
    expect(vec).toHaveLength(1);
    expect(vec[0].switch().name).toBe("scvSymbol");
    expect(vec[0].sym().toString()).toBe("Retail");
  });

  test("each unit variant round-trips through scValToNative", () => {
    const units = ["Retail", "Food", "Services", "Digital", "Other"] as const;
    for (const variant of units) {
      const scVal = serializeMerchantCategory(variant);
      const native = scValToNative(scVal);
      expect(native).toEqual([variant]);
    }
  });

  test("Custom('Handmade') serializes to ScVec([ScSymbol('Custom'), ScString('Handmade')])", () => {
    const scVal = serializeMerchantCategory({ Custom: "Handmade" });
    expect(scVal.switch().name).toBe("scvVec");
    const vec = scVal.vec();
    expect(vec).toHaveLength(2);
    expect(vec[0].switch().name).toBe("scvSymbol");
    expect(vec[0].sym().toString()).toBe("Custom");
    expect(vec[1].switch().name).toBe("scvString");
    expect(vec[1].str().toString()).toBe("Handmade");
  });

  test("Custom('Handmade') round-trips through scValToNative", () => {
    const scVal = serializeMerchantCategory({ Custom: "Handmade" });
    const native = scValToNative(scVal);
    // scValToNative returns ["Custom", "Handmade"] for a ScVec enum tuple
    expect(native).toEqual(["Custom", "Handmade"]);
  });

  test("throws when Custom label is empty", () => {
    expect(() => serializeMerchantCategory({ Custom: "" })).toThrow(
      /empty/i
    );
  });

  test("throws when Custom label exceeds 32 characters", () => {
    expect(() =>
      serializeMerchantCategory({ Custom: "a".repeat(33) })
    ).toThrow(/32/);
  });

  test("accepts Custom label of exactly 32 characters", () => {
    const label = "a".repeat(32);
    expect(() => serializeMerchantCategory({ Custom: label })).not.toThrow();
    const scVal = serializeMerchantCategory({ Custom: label });
    expect(scVal.vec()[1].str().toString()).toBe(label);
  });
});

// ── Custom('Handmade') end-to-end round-trip ──────────────────────────────────

describe("registerMerchant with Custom category — round-trip", () => {
  const { Keypair, xdr, nativeToScVal, scValToNative } =
    jest.requireActual("@stellar/stellar-sdk");
  const source = Keypair.random();

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue(makeAccount(source.publicKey()));
    mockSendTransaction.mockResolvedValue({
      hash: "custom-round-trip-hash",
      status: "PENDING",
    });
    mockGetTransaction.mockResolvedValue({
      status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
      returnValue: nativeToScVal(null),
    });
  });

  test("registerMerchant with Custom('Handmade') submits and confirms", async () => {
    mockSimulateTransaction.mockResolvedValue(
      makeSuccessSimulation(nativeToScVal(null))
    );

    const client = makeClient();
    client.setSigner((tx) => {
      tx.sign(source);
      return tx;
    });

    // Should not throw — the Custom variant must be serialized correctly
    await expect(
      client.registerMerchant(
        source.publicKey(),
        "Artisan Goods",
        "Handcrafted items",
        "hello@artisan.com",
        { Custom: "Handmade" }
      )
    ).resolves.toBeUndefined();

    expect(mockSendTransaction).toHaveBeenCalledTimes(1);
    expect(mockGetTransaction).toHaveBeenCalledTimes(1);
  });

  test("the ScVal passed to simulateTransaction contains the Custom enum encoding", async () => {
    mockSimulateTransaction.mockResolvedValue(
      makeSuccessSimulation(nativeToScVal(null))
    );

    const client = makeClient();
    client.setSigner((tx) => {
      tx.sign(source);
      return tx;
    });

    await client.registerMerchant(
      source.publicKey(),
      "Artisan Goods",
      "Handcrafted items",
      "hello@artisan.com",
      { Custom: "Handmade" }
    );

    // Inspect the transaction passed to simulateTransaction
    const [[submittedTx]] = mockSimulateTransaction.mock.calls;
    const op = submittedTx.operations[0] as any;
    const args: xdr.ScVal[] = op.func.invokeContract().args();

    // args[4] is the category (after address, name, description, contactInfo)
    const categoryArg = args[4];
    expect(categoryArg.switch().name).toBe("scvVec");
    const vec = categoryArg.vec();
    expect(vec).toHaveLength(2);
    expect(vec[0].sym().toString()).toBe("Custom");
    expect(vec[1].str().toString()).toBe("Handmade");
  });

  test("getMerchant correctly deserializes a Custom category response", async () => {
    // Simulate contract returning a merchant with a Custom category
    const categoryScVal = xdr.ScVal.scvVec([
      xdr.ScVal.scvSymbol("Custom"),
      xdr.ScVal.scvString("Handmade"),
    ]);

    const merchantScVal = xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("name"),
        val: xdr.ScVal.scvString("Artisan Goods"),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("category"),
        val: categoryScVal,
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol("active"),
        val: xdr.ScVal.scvBool(true),
      }),
    ]);

    mockSimulateTransaction.mockResolvedValue(
      makeSuccessSimulation(merchantScVal)
    );

    const client = makeClient();
    const merchant = await client.getMerchant(source.publicKey());

    // scValToNative converts ScVec([Symbol("Custom"), String("Handmade")]) → ["Custom", "Handmade"]
    expect(merchant.category).toEqual(["Custom", "Handmade"]);
    expect(merchant.name).toBe("Artisan Goods");
  });
});
