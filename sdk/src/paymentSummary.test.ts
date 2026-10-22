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
      paidAt: 1_700_000_000n,
    };
    const call = jest.spyOn(client as any, "call").mockResolvedValue(summary);

    await expect(client.getPaymentSummary("ORDER-001")).resolves.toEqual(summary);
    expect(call).toHaveBeenCalledWith("get_payment_summary", ["ORDER-001"]);
  });
});