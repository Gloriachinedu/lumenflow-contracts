import { ClientConfig, NETWORK_PRESETS } from "./types";

export class ConfigValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigValidationError";
  }
}

/**
 * Resolve the effective RPC URL and network passphrase from a ClientConfig.
 * Explicit values always override the named network preset.
 *
 * @throws ConfigValidationError when required fields are missing or invalid.
 */
export function resolveNetworkConfig(config: ClientConfig): {
  rpcUrl: string;
  networkPassphrase: string;
} {
  if (!config.contractId || config.contractId.trim() === "") {
    throw new ConfigValidationError("ClientConfig.contractId is required.");
  }

  const preset = config.network ? NETWORK_PRESETS[config.network] : undefined;

  const rpcUrl = config.rpcUrl ?? preset?.rpcUrl;
  const networkPassphrase =
    config.networkPassphrase ?? preset?.networkPassphrase;

  if (!rpcUrl) {
    throw new ConfigValidationError(
      "ClientConfig: rpcUrl is required when no named network preset is provided."
    );
  }
  if (!networkPassphrase) {
    throw new ConfigValidationError(
      "ClientConfig: networkPassphrase is required when no named network preset is provided."
    );
  }

  return { rpcUrl, networkPassphrase };
}

/**
 * Resolve the effective strict-mode flag from a ClientConfig.
 *
 * When `strict` is `true`, the client throws on SDK/contract version
 * incompatibility during initialization. When `strict` is `false` or
 * omitted (the default), an incompatible version only logs a warning.
 */
export function resolveStrictMode(config: ClientConfig): boolean {
  return config.strict === true;
}