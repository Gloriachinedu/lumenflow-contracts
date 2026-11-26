/**
 * Tests for LumenFlowClient contract version check on initialisation (#663).
 */

import {
  LumenFlowClient,
  SDK_CONTRACT_MAJOR_VERSION,
  SDK_CONTRACT_MINOR_VERSION,
} from "./client";

const BASE_CONFIG = {
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

function makeClient(overrides: Partial<ConstructorParameters<typeof LumenFlowClient>[0]> = {}) {
  return new LumenFlowClient({ ...BASE_CONFIG, ...overrides });
}

describe("LumenFlowClient – contract version check (#663)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("checkContractVersion()", () => {
    it("passes silently when major and minor versions match", async () => {
      const client = makeClient();
      jest
        .spyOn(client, "getContractVersion")
        .mockResolvedValue(
          `${SDK_CONTRACT_MAJOR_VERSION}.${SDK_CONTRACT_MINOR_VERSION}.0`
        );

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      await expect(client.checkContractVersion()).resolves.toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("passes silently when only the patch version differs", async () => {
      const client = makeClient();
      jest
        .spyOn(client, "getContractVersion")
        .mockResolvedValue(
          `${SDK_CONTRACT_MAJOR_VERSION}.${SDK_CONTRACT_MINOR_VERSION}.99`
        );

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      await expect(client.checkContractVersion()).resolves.toBeUndefined();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("logs a warning when minor version differs (default mode)", async () => {
      const client = makeClient();
      const mismatchMinor = SDK_CONTRACT_MINOR_VERSION + 1;
      jest
        .spyOn(client, "getContractVersion")
        .mockResolvedValue(`${SDK_CONTRACT_MAJOR_VERSION}.${mismatchMinor}.0`);

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      await expect(client.checkContractVersion()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Contract version mismatch")
      );
    });

    it("throws an error when minor version differs and strictVersionCheck is true", async () => {
      const client = makeClient({ strictVersionCheck: true });
      const mismatchMinor = SDK_CONTRACT_MINOR_VERSION + 1;
      jest
        .spyOn(client, "getContractVersion")
        .mockResolvedValue(`${SDK_CONTRACT_MAJOR_VERSION}.${mismatchMinor}.0`);

      jest.spyOn(console, "warn").mockImplementation(() => {});
      await expect(client.checkContractVersion()).rejects.toThrow(
        "Contract version mismatch"
      );
    });

    it("logs a warning when major version differs (default mode)", async () => {
      const client = makeClient();
      const mismatchMajor = SDK_CONTRACT_MAJOR_VERSION + 1;
      jest
        .spyOn(client, "getContractVersion")
        .mockResolvedValue(`${mismatchMajor}.0.0`);

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      await expect(client.checkContractVersion()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Contract version mismatch")
      );
    });

    it("throws an error when major version differs and strictVersionCheck is true", async () => {
      const client = makeClient({ strictVersionCheck: true });
      const mismatchMajor = SDK_CONTRACT_MAJOR_VERSION + 1;
      jest
        .spyOn(client, "getContractVersion")
        .mockResolvedValue(`${mismatchMajor}.0.0`);

      jest.spyOn(console, "warn").mockImplementation(() => {});
      await expect(client.checkContractVersion()).rejects.toThrow(
        "Contract version mismatch"
      );
    });

    it("logs a warning (not a throw) when RPC call fails in default mode", async () => {
      const client = makeClient();
      jest
        .spyOn(client, "getContractVersion")
        .mockRejectedValue(new Error("network error"));

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      await expect(client.checkContractVersion()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unable to fetch contract version"),
        expect.any(Error)
      );
    });

    it("skips the check entirely when skipVersionCheck is true", async () => {
      const client = makeClient({ skipVersionCheck: true });
      const getVersionSpy = jest
        .spyOn(client, "getContractVersion")
        .mockResolvedValue("99.0.0");

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      await expect(client.checkContractVersion()).resolves.toBeUndefined();
      expect(getVersionSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("logs a warning when the version string is unparseable", async () => {
      const client = makeClient();
      jest
        .spyOn(client, "getContractVersion")
        .mockResolvedValue("not-a-semver");

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      await expect(client.checkContractVersion()).resolves.toBeUndefined();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("unparseable version string")
      );
    });
  });

  describe("LumenFlowClient.init()", () => {
    it("calls get_contract_version on initialization", async () => {
      const getVersionSpy = jest
        .spyOn(LumenFlowClient.prototype, "getContractVersion")
        .mockResolvedValue(
          `${SDK_CONTRACT_MAJOR_VERSION}.${SDK_CONTRACT_MINOR_VERSION}.0`
        );

      jest.spyOn(console, "warn").mockImplementation(() => {});
      await LumenFlowClient.init(BASE_CONFIG);
      expect(getVersionSpy).toHaveBeenCalledTimes(1);
    });

    it("returns a client instance when version matches", async () => {
      jest
        .spyOn(LumenFlowClient.prototype, "getContractVersion")
        .mockResolvedValue(
          `${SDK_CONTRACT_MAJOR_VERSION}.${SDK_CONTRACT_MINOR_VERSION}.0`
        );

      jest.spyOn(console, "warn").mockImplementation(() => {});
      const client = await LumenFlowClient.init(BASE_CONFIG);
      expect(client).toBeInstanceOf(LumenFlowClient);
    });

    it("warns but resolves on minor mismatch in default mode", async () => {
      jest
        .spyOn(LumenFlowClient.prototype, "getContractVersion")
        .mockResolvedValue(
          `${SDK_CONTRACT_MAJOR_VERSION}.${SDK_CONTRACT_MINOR_VERSION + 1}.0`
        );

      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      const client = await LumenFlowClient.init(BASE_CONFIG);
      expect(client).toBeInstanceOf(LumenFlowClient);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Contract version mismatch")
      );
    });

    it("propagates the minor-mismatch error in strict mode", async () => {
      jest
        .spyOn(LumenFlowClient.prototype, "getContractVersion")
        .mockResolvedValue(
          `${SDK_CONTRACT_MAJOR_VERSION}.${SDK_CONTRACT_MINOR_VERSION + 1}.0`
        );

      jest.spyOn(console, "warn").mockImplementation(() => {});
      await expect(
        LumenFlowClient.init({ ...BASE_CONFIG, strictVersionCheck: true })
      ).rejects.toThrow("Contract version mismatch");
    });

    it("propagates the major-mismatch error in strict mode", async () => {
      jest
        .spyOn(LumenFlowClient.prototype, "getContractVersion")
        .mockResolvedValue(`${SDK_CONTRACT_MAJOR_VERSION + 1}.0.0`);

      jest.spyOn(console, "warn").mockImplementation(() => {});
      await expect(
        LumenFlowClient.init({ ...BASE_CONFIG, strictVersionCheck: true })
      ).rejects.toThrow("Contract version mismatch");
    });
  });
});
