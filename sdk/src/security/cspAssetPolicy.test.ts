import {
  serializeCsp,
  buildDashboardCspPolicy,
  buildDashboardCspHeader,
  LUMENFLOW_CDN,
  STELLAR_CDN,
} from './cspAssetPolicy';

describe('serializeCsp', () => {
  it('serializes source-list directives', () => {
    const result = serializeCsp({ defaultSrc: ["'self'"], scriptSrc: ["'self'", LUMENFLOW_CDN] });
    expect(result).toContain("default-src 'self'");
    expect(result).toContain(`script-src 'self' ${LUMENFLOW_CDN}`);
  });

  it('serializes boolean directives', () => {
    const result = serializeCsp({ upgradeInsecureRequests: true, blockAllMixedContent: false });
    expect(result).toContain('upgrade-insecure-requests');
    expect(result).not.toContain('block-all-mixed-content');
  });

  it('omits empty source arrays', () => {
    const result = serializeCsp({ defaultSrc: [], scriptSrc: ["'self'"] });
    expect(result).not.toContain('default-src');
    expect(result).toContain('script-src');
  });
});

describe('buildDashboardCspPolicy', () => {
  it('returns a strict policy with no unsafe-inline by default', () => {
    const policy = buildDashboardCspPolicy();
    const header = serializeCsp(policy);
    expect(header).not.toContain("'unsafe-inline'");
    expect(header).not.toContain("'unsafe-eval'");
  });

  it('locks down frame-ancestors and object-src to none', () => {
    const header = serializeCsp(buildDashboardCspPolicy());
    expect(header).toContain("frame-ancestors 'none'");
    expect(header).toContain("object-src 'none'");
  });

  it('includes nonce in script-src when provided', () => {
    const header = serializeCsp(buildDashboardCspPolicy({ nonce: 'abc123' }));
    expect(header).toContain("'nonce-abc123'");
  });

  it('includes Stellar CDN when opt-in', () => {
    const header = serializeCsp(buildDashboardCspPolicy({ includeStellarCdn: true }));
    expect(header).toContain(STELLAR_CDN);
  });

  it('excludes LumenFlow CDN when disabled', () => {
    const header = serializeCsp(buildDashboardCspPolicy({ includeLumenflowCdn: false }));
    expect(header).not.toContain(LUMENFLOW_CDN);
  });

  it('appends extra connect-src origins', () => {
    const header = serializeCsp(
      buildDashboardCspPolicy({ extraConnectSrc: ['https://horizon.stellar.org'] }),
    );
    expect(header).toContain('https://horizon.stellar.org');
  });

  it('includes upgrade-insecure-requests', () => {
    const header = serializeCsp(buildDashboardCspPolicy());
    expect(header).toContain('upgrade-insecure-requests');
  });
});

describe('buildDashboardCspHeader', () => {
  it('returns a non-empty string', () => {
    const header = buildDashboardCspHeader();
    expect(typeof header).toBe('string');
    expect(header.length).toBeGreaterThan(0);
  });
});
