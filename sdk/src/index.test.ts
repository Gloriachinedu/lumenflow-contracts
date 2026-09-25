import { LumenFlowClient, VERSION } from "./index";

describe("SDK version", () => {
  it("exports a semver version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it("sends the SDK version on RPC calls", async () => {
    const fetcher = jest.fn().mockResolvedValue({
      json: async () => ({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
    });
    const client = new LumenFlowClient("https://rpc.example", fetcher);

    await expect(client.call("get_payment", ["ORDER_1"])).resolves.toEqual({
      ok: true,
    });
    expect(fetcher).toHaveBeenCalledWith(
      "https://rpc.example",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-SDK-Version": VERSION }),
      }),
    );
  });
});
