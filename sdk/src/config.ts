/**
 * Multi-network configuration for the LumenFlow SDK.
 *
 * Supports `local`, `testnet`, and `mainnet` presets. Each preset
 * auto-populates the RPC URL, Horizon URL, and network passphrase.
 * Individual URLs can be overridden after preset selection.
 */

/** Supported Stellar network identifiers. */
export type NetworkName = 'local' | 'testnet' | 'mainnet';

/** Full configuration for one LumenFlow network connection. */
export interface LumenFlowConfig {
  /** Network preset. Determines default URLs and passphrase. */
  network: NetworkName;
  /** Soroban RPC endpoint. Defaults to the preset URL if not provided. */
  rpcUrl?: string;
  /** Horizon REST endpoint. Defaults to the preset URL if not provided. */
  horizonUrl?: string;
  /** Network passphrase used when signing transactions. Defaults to the preset value. */
  networkPassphrase?: string;
  /** Deployed LumenFlow contract ID (optional for read-only operations). */
  contractId?: string;
}

/** A resolved configuration with all fields populated (no optional URLs). */
export interface ResolvedLumenFlowConfig {
  network: NetworkName;
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
  contractId?: string;
}

/** Built-in defaults for each supported network. */
interface NetworkPreset {
  rpcUrl: string;
  horizonUrl: string;
  networkPassphrase: string;
}

const NETWORK_PRESETS: Record<NetworkName, NetworkPreset> = {
  local: {
    rpcUrl: 'http://localhost:8000/soroban/rpc',
    horizonUrl: 'http://localhost:8000',
    networkPassphrase: 'Standalone Network ; February 2017',
  },
  testnet: {
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    networkPassphrase: 'Test SDF Network ; September 2015',
  },
  mainnet: {
    rpcUrl: 'https://mainnet.stellar.validationcloud.io/v1/soroban/rpc',
    horizonUrl: 'https://horizon.stellar.org',
    networkPassphrase: 'Public Global Stellar Network ; September 2015',
  },
};

/**
 * Returns the default configuration for a named network.
 *
 * @param network - One of 'local', 'testnet', or 'mainnet'.
 * @returns A fully-populated `ResolvedLumenFlowConfig` with preset defaults.
 *
 * @example
 * const config = getDefaultConfig('testnet');
 * // { network: 'testnet', rpcUrl: 'https://soroban-testnet.stellar.org', ... }
 */
export function getDefaultConfig(network: NetworkName): ResolvedLumenFlowConfig {
  const preset = NETWORK_PRESETS[network];
  return {
    network,
    rpcUrl: preset.rpcUrl,
    horizonUrl: preset.horizonUrl,
    networkPassphrase: preset.networkPassphrase,
  };
}

/**
 * Resolves a `LumenFlowConfig` by merging preset defaults with any
 * caller-supplied overrides.
 *
 * Individual URL overrides take priority over the network preset values.
 *
 * @param config - Partial config with required `network` field.
 * @returns `ResolvedLumenFlowConfig` with all fields populated.
 */
export function resolveConfig(config: LumenFlowConfig): ResolvedLumenFlowConfig {
  const preset = NETWORK_PRESETS[config.network];
  return {
    network: config.network,
    rpcUrl: config.rpcUrl ?? preset.rpcUrl,
    horizonUrl: config.horizonUrl ?? preset.horizonUrl,
    networkPassphrase: config.networkPassphrase ?? preset.networkPassphrase,
    contractId: config.contractId,
  };
}

/**
 * LumenFlowClient provides a typed SDK client bound to a single network.
 *
 * @example
 * const client = new LumenFlowClient({ network: 'testnet' });
 * console.log(client.network);     // 'testnet'
 * console.log(client.config.rpcUrl); // 'https://soroban-testnet.stellar.org'
 */
export class LumenFlowClient {
  /** Resolved configuration with all fields populated. */
  public readonly config: ResolvedLumenFlowConfig;

  constructor(userConfig: LumenFlowConfig) {
    this.config = resolveConfig(userConfig);
  }

  /** Read-only network identifier ('local' | 'testnet' | 'mainnet'). */
  get network(): NetworkName {
    return this.config.network;
  }
}
