import { LumenFlowClient } from "./client";
import { PaymentStatus, PaymentSummary } from "./types";

describe("LumenFlowClient.getPaymentSummary", () => {
  it("queries the public summary without a signer", async () => {
    const client = new LumenFlowClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    const summary: PaymentSummary = {
      orderId: "ORDER-001",
      merchantAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      amount: 500n,
      token: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      status: PaymentStatus.Completed,
      createdAt: 1_700_000_000n,
    };
    const call = jest.spyOn(client as any, "call").mockResolvedValue(summary);

    await expect(client.getPaymentSummary("ORDER-001")).resolves.toEqual(summary);
    expect(call).toHaveBeenCalledWith("get_payment_summary", ["ORDER-001"]);
  });

  it("calls get_payment_summary with only the order_id argument and no signer", async () => {
    const client = new LumenFlowClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    const summary: PaymentSummary = {
      orderId: "ORDER-002",
      merchantAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      amount: 1_000n,
      token: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      status: PaymentStatus.Pending,
      createdAt: 1_700_000_100n,
    };
    const call = jest.spyOn(client as any, "call").mockResolvedValue(summary);

    const result = await client.getPaymentSummary("ORDER-002");

    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("get_payment_summary", ["ORDER-002"]);
    const [entrypoint, args] = call.mock.calls[0];
    expect(entrypoint).toBe("get_payment_summary");
    expect(args).toEqual(["ORDER-002"]);
    expect(args).toHaveLength(1);
    expect(result).toEqual(summary);
  });

  it("returns the sanitized PaymentSummary shape without a payer field", async () => {
    const client = new LumenFlowClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    });
    const summary: PaymentSummary = {
      orderId: "ORDER-003",
      merchantAddress: "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
      amount: 250n,
      token: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM",
      status: PaymentStatus.Completed,
      createdAt: 1_700_000_200n,
    };
    jest.spyOn(client as any, "call").mockResolvedValue(summary);

    const result = await client.getPaymentSummary("ORDER-003");

    expect(result.orderId).toBe("ORDER-003");
    expect(result.merchantAddress).toBe(
      "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    );
    expect(result.amount).toBe(250n);
    expect(result.status).toBe(PaymentStatus.Completed);
    expect(result.createdAt).toBe(1_700_000_200n);
    expect(result).not.toHaveProperty("payer");
    expect(result).not.toHaveProperty("payerAddress");
  });
});