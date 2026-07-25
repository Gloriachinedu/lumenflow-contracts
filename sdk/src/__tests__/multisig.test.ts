/**
 * SDK multisig workflow tests — simulates signer actions against the
 * LumenFlowClient multisig API using a mocked Soroban RPC layer.
 *
 * Covers issue #344: SDK tests that simulate the full initiate → sign → execute
 * lifecycle and validate error paths (insufficient signatures, non-signer, etc.).
 */

import { LumenFlowClient, NETWORKS, LumenFlowError, PaymentErrorCode } from "../index";
import { SorobanRpc, nativeToScVal, Keypair } from "@stellar/stellar-sdk";

// ── Mock setup ────────────────────────────────────────────────────────────────

const mockSimulate = jest.fn();
const mockGetAccount = jest.fn();
const mockSendTx = jest.fn();
const mockGetTx = jest.fn();

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn().mockImplementation(() => ({
        simulateTransaction: mockSimulate,
        getAccount: mockGetAccount,
        sendTransaction: mockSendTx,
        getTransaction: mockGetTx,
      })),
    },
  };
});

const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM";
const MERCHANT = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN";
const TOKEN = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const { Keypair: ActualKeypair } = jest.requireActual("@stellar/stellar-sdk");
const initiator = ActualKeypair.random();
const signer1 = ActualKeypair.random();
const signer2 = ActualKeypair.random();

function makeSimulationOk(value: unknown = null) {
  return {
    result: { retval: nativeToScVal(value) },
    minResourceFee: "100",
    _parsed: true,
  };
}

function makeAccount(kp: typeof initiator) {
  return {
    accountId: () => kp.publicKey(),
    sequenceNumber: () => "1000",
    incrementSequenceNumber: jest.fn(),
  };
}

function makeTxSuccess() {
  return {
    status: SorobanRpc.Api.GetTransactionStatus.SUCCESS,
    returnValue: nativeToScVal(null),
  };
}

function makeClient() {
  return new LumenFlowClient({
    contractId: CONTRACT_ID,
    rpcUrl: NETWORKS.testnet.rpcUrl,
    networkPassphrase: NETWORKS.testnet.networkPassphrase,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("LumenFlowClient — multisig lifecycle", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAccount.mockResolvedValue(makeAccount(initiator));
    mockSendTx.mockResolvedValue({ hash: "deadbeef", status: "PENDING" });
    mockGetTx.mockResolvedValue(makeTxSuccess());
  });

  test("initiateMultisigPayment sends correct contract call", async () => {
    mockSimulate.mockResolvedValue(makeSimulationOk());

    const client = makeClient();
    client.setSigner(async (tx) => { tx.sign(initiator); return tx; });

    await client.initiateMultisigPayment(
      initiator.publicKey(),
      "MS-SDK-001",
      MERCHANT,
      TOKEN,
      50_000_000n,
      [signer1.publicKey(), signer2.publicKey()],
      2,
    );

    expect(mockSimulate).toHaveBeenCalledTimes(1);
    expect(mockSendTx).toHaveBeenCalledTimes(1);
  });

  test("signMultisigPayment sends correct contract call", async () => {
    mockSimulate.mockResolvedValue(makeSimulationOk());

    const client = makeClient();
    client.setSigner(async (tx) => { tx.sign(signer1); return tx; });

    await client.signMultisigPayment(
      signer1.publicKey(),
      "MS-SDK-001",
      Buffer.alloc(64, 1),
    );

    expect(mockSimulate).toHaveBeenCalledTimes(1);
    expect(mockSendTx).toHaveBeenCalledTimes(1);
  });

  test("executeMultisigPayment sends correct contract call", async () => {
    mockSimulate.mockResolvedValue(makeSimulationOk());

    const client = makeClient();
    client.setSigner(async (tx) => { tx.sign(initiator); return tx; });

    await client.executeMultisigPayment(initiator.publicKey(), "MS-SDK-001");

    expect(mockSendTx).toHaveBeenCalledTimes(1);
  });

  test("full lifecycle: initiate → two signs → execute succeeds", async () => {
    mockSimulate.mockResolvedValue(makeSimulationOk());

    const client = makeClient();

    // Step 1: initiate (initiator key)
    mockGetAccount.mockResolvedValue(makeAccount(initiator));
    client.setSigner(async (tx) => { tx.sign(initiator); return tx; });
    await client.initiateMultisigPayment(
      initiator.publicKey(),
      "MS-SDK-FULL",
      MERCHANT,
      TOKEN,
      10_000_000n,
      [signer1.publicKey(), signer2.publicKey()],
      2,
    );

    // Step 2: signer1 signs
    mockGetAccount.mockResolvedValue(makeAccount(signer1));
    client.setSigner(async (tx) => { tx.sign(signer1); return tx; });
    await client.signMultisigPayment(signer1.publicKey(), "MS-SDK-FULL", Buffer.alloc(64, 1));

    // Step 3: signer2 signs
    mockGetAccount.mockResolvedValue(makeAccount(signer2));
    client.setSigner(async (tx) => { tx.sign(signer2); return tx; });
    await client.signMultisigPayment(signer2.publicKey(), "MS-SDK-FULL", Buffer.alloc(64, 2));

    // Step 4: execute
    mockGetAccount.mockResolvedValue(makeAccount(initiator));
    client.setSigner(async (tx) => { tx.sign(initiator); return tx; });
    await client.executeMultisigPayment(initiator.publicKey(), "MS-SDK-FULL");

    // All four contract calls went through
    expect(mockSendTx).toHaveBeenCalledTimes(4);
  });

  test("initiateMultisigPayment surfaces InsufficientSignatures contract error", async () => {
    mockSimulate.mockResolvedValue({
      error: `Error(Contract, #${PaymentErrorCode.InsufficientSignatures})`,
    });

    const client = makeClient();
    client.setSigner(async (tx) => { tx.sign(initiator); return tx; });

    const err = await client
      .executeMultisigPayment(initiator.publicKey(), "MS-SDK-ERR")
      .catch((e) => e);

    expect(err).toBeInstanceOf(LumenFlowError);
    expect((err as LumenFlowError).code).toBe(PaymentErrorCode.InsufficientSignatures);
  });

  test("signMultisigPayment surfaces Unauthorized for non-signer", async () => {
    mockSimulate.mockResolvedValue({
      error: `Error(Contract, #${PaymentErrorCode.Unauthorized})`,
    });

    const client = makeClient();
    const stranger = ActualKeypair.random();
    client.setSigner(async (tx) => { tx.sign(stranger); return tx; });

    const err = await client
      .signMultisigPayment(stranger.publicKey(), "MS-SDK-AUTH", Buffer.alloc(64, 9))
      .catch((e) => e);

    expect(err).toBeInstanceOf(LumenFlowError);
    expect((err as LumenFlowError).code).toBe(PaymentErrorCode.Unauthorized);
  });

  test("signMultisigPayment surfaces MultisigAlreadySigned on double sign", async () => {
    mockSimulate.mockResolvedValue({
      error: `Error(Contract, #${PaymentErrorCode.MultisigAlreadySigned})`,
    });

    const client = makeClient();
    client.setSigner(async (tx) => { tx.sign(signer1); return tx; });

    const err = await client
      .signMultisigPayment(signer1.publicKey(), "MS-SDK-DOUBLE", Buffer.alloc(64, 1))
      .catch((e) => e);

    expect(err).toBeInstanceOf(LumenFlowError);
    expect((err as LumenFlowError).code).toBe(PaymentErrorCode.MultisigAlreadySigned);
  });

  test("executeMultisigPayment surfaces MultisigAlreadyExecuted", async () => {
    mockSimulate.mockResolvedValue({
      error: `Error(Contract, #${PaymentErrorCode.MultisigAlreadyExecuted})`,
    });

    const client = makeClient();
    client.setSigner(async (tx) => { tx.sign(initiator); return tx; });

    const err = await client
      .executeMultisigPayment(initiator.publicKey(), "MS-SDK-REEXEC")
      .catch((e) => e);

    expect(err).toBeInstanceOf(LumenFlowError);
    expect((err as LumenFlowError).code).toBe(PaymentErrorCode.MultisigAlreadyExecuted);
  });

  test("initiateMultisigPayment requires a signer", async () => {
    const client = makeClient(); // no signer set

    await expect(
      client.initiateMultisigPayment(
        initiator.publicKey(),
        "MS-NO-SIGNER",
        MERCHANT,
        TOKEN,
        1_000n,
        [signer1.publicKey()],
        1,
      )
    ).rejects.toThrow("signer");
  });
});
