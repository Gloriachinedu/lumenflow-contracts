import { LumenFlowClient, VERSION } from "./index";

describe("SDK version", () => {
  it("exports a semver version", () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  });

  it("sends the SDK version on RPC calls", async () => {
    const client = new LumenFlowClient({
      contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      rpcUrl: "https://rpc.example",
      networkPassphrase: "Test SDF Network ; September 2015",
      skipVersionCheck: true,
    });

    expect(client.server.httpClient.defaults.headers["X-SDK-Version"]).toBe(
      VERSION,
    );
  });
});
