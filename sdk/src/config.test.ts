import {
  getDefaultConfig,
  resolveConfig,
  LumenFlowClient,
  ResolvedLumenFlowConfig,
} from './config';

describe('getDefaultConfig', () => {
  it('returns correct local preset', () => {
    const cfg = getDefaultConfig('local');
    expect(cfg.network).toBe('local');
    expect(cfg.rpcUrl).toBe('http://localhost:8000/soroban/rpc');
    expect(cfg.horizonUrl).toBe('http://localhost:8000');
    expect(cfg.networkPassphrase).toBe('Standalone Network ; February 2017');
  });

  it('returns correct testnet preset', () => {
    const cfg = getDefaultConfig('testnet');
    expect(cfg.network).toBe('testnet');
    expect(cfg.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(cfg.horizonUrl).toBe('https://horizon-testnet.stellar.org');
    expect(cfg.networkPassphrase).toBe('Test SDF Network ; September 2015');
  });

  it('returns correct mainnet preset', () => {
    const cfg = getDefaultConfig('mainnet');
    expect(cfg.network).toBe('mainnet');
    expect(cfg.horizonUrl).toBe('https://horizon.stellar.org');
    expect(cfg.networkPassphrase).toBe(
      'Public Global Stellar Network ; September 2015',
    );
  });

  it('all presets have rpcUrl, horizonUrl, and networkPassphrase populated', () => {
    for (const network of ['local', 'testnet', 'mainnet'] as const) {
      const cfg = getDefaultConfig(network);
      expect(cfg.rpcUrl).toBeTruthy();
      expect(cfg.horizonUrl).toBeTruthy();
      expect(cfg.networkPassphrase).toBeTruthy();
    }
  });
});

describe('resolveConfig', () => {
  it('fills defaults from preset when no overrides are provided', () => {
    const cfg = resolveConfig({ network: 'testnet' });
    expect(cfg.rpcUrl).toBe('https://soroban-testnet.stellar.org');
    expect(cfg.horizonUrl).toBe('https://horizon-testnet.stellar.org');
  });

  it('overrides rpcUrl when provided', () => {
    const cfg = resolveConfig({
      network: 'testnet',
      rpcUrl: 'https://my-rpc.example.com',
    });
    expect(cfg.rpcUrl).toBe('https://my-rpc.example.com');
    // Other fields still use preset defaults
    expect(cfg.horizonUrl).toBe('https://horizon-testnet.stellar.org');
  });

  it('overrides horizonUrl when provided', () => {
    const cfg = resolveConfig({
      network: 'mainnet',
      horizonUrl: 'https://my-horizon.example.com',
    });
    expect(cfg.horizonUrl).toBe('https://my-horizon.example.com');
    expect(cfg.networkPassphrase).toBe(
      'Public Global Stellar Network ; September 2015',
    );
  });

  it('overrides networkPassphrase when provided', () => {
    const cfg = resolveConfig({
      network: 'local',
      networkPassphrase: 'Custom Network ; 2024',
    });
    expect(cfg.networkPassphrase).toBe('Custom Network ; 2024');
  });

  it('includes contractId when provided', () => {
    const cfg = resolveConfig({
      network: 'testnet',
      contractId: 'CABC1234',
    });
    expect(cfg.contractId).toBe('CABC1234');
  });

  it('leaves contractId undefined when not provided', () => {
    const cfg = resolveConfig({ network: 'testnet' });
    expect(cfg.contractId).toBeUndefined();
  });
});

describe('LumenFlowClient', () => {
  it('exposes network as a read-only property', () => {
    const client = new LumenFlowClient({ network: 'testnet' });
    expect(client.network).toBe('testnet');
  });

  it('exposes fully resolved config', () => {
    const client = new LumenFlowClient({ network: 'mainnet' });
    const cfg: ResolvedLumenFlowConfig = client.config;
    expect(cfg.network).toBe('mainnet');
    expect(cfg.rpcUrl).toContain('mainnet');
    expect(cfg.horizonUrl).toContain('horizon.stellar.org');
  });

  it('uses custom rpcUrl override', () => {
    const client = new LumenFlowClient({
      network: 'testnet',
      rpcUrl: 'https://custom-rpc.example.com',
    });
    expect(client.config.rpcUrl).toBe('https://custom-rpc.example.com');
  });

  it('network property is consistent with config.network', () => {
    for (const net of ['local', 'testnet', 'mainnet'] as const) {
      const client = new LumenFlowClient({ network: net });
      expect(client.network).toBe(client.config.network);
    }
  });
});
