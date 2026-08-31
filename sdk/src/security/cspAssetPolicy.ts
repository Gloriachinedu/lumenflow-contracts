/**
 * LumenFlow SDK — Content-Security-Policy compatible frontend asset policy.
 *
 * Provides helpers for building CSP headers that are compatible with the
 * LumenFlow dashboard's frontend asset pipeline (JS bundles, stylesheets,
 * fonts, and Stellar-related CDN resources).
 *
 * Design goals
 * ------------
 * - No `unsafe-inline` or `unsafe-eval` in the default policy.
 * - Nonce-based inline script allowances only (for server-rendered pages).
 * - Fine-grained per-directive customisation without string concatenation.
 * - A serialiser that produces a valid single-line CSP header value.
 *
 * Closes #798.
 */

/** Well-known external origins used by the LumenFlow frontend. */
export const STELLAR_CDN = 'https://cdn.jsdelivr.net';
export const LUMENFLOW_CDN = 'https://assets.lumenflow.io';

export type CspKeyword =
  | "'self'"
  | "'none'"
  | "'unsafe-inline'"
  | "'unsafe-eval'"
  | "'strict-dynamic'"
  | "'wasm-unsafe-eval'";

/** A CSP directive value: a list of source expressions. */
export type CspSources = Array<string | CspKeyword>;

export interface CspDirectives {
  defaultSrc?: CspSources;
  scriptSrc?: CspSources;
  scriptSrcAttr?: CspSources;
  scriptSrcElem?: CspSources;
  styleSrc?: CspSources;
  styleSrcAttr?: CspSources;
  styleSrcElem?: CspSources;
  imgSrc?: CspSources;
  fontSrc?: CspSources;
  connectSrc?: CspSources;
  mediaSrc?: CspSources;
  objectSrc?: CspSources;
  frameSrc?: CspSources;
  frameAncestors?: CspSources;
  workerSrc?: CspSources;
  manifestSrc?: CspSources;
  baseUri?: CspSources;
  formAction?: CspSources;
  upgradeInsecureRequests?: boolean;
  blockAllMixedContent?: boolean;
}

/** Map a camelCase directive name to its CSP header name. */
const DIRECTIVE_MAP: Record<keyof CspDirectives, string> = {
  defaultSrc: 'default-src',
  scriptSrc: 'script-src',
  scriptSrcAttr: 'script-src-attr',
  scriptSrcElem: 'script-src-elem',
  styleSrc: 'style-src',
  styleSrcAttr: 'style-src-attr',
  styleSrcElem: 'style-src-elem',
  imgSrc: 'img-src',
  fontSrc: 'font-src',
  connectSrc: 'connect-src',
  mediaSrc: 'media-src',
  objectSrc: 'object-src',
  frameSrc: 'frame-src',
  frameAncestors: 'frame-ancestors',
  workerSrc: 'worker-src',
  manifestSrc: 'manifest-src',
  baseUri: 'base-uri',
  formAction: 'form-action',
  upgradeInsecureRequests: 'upgrade-insecure-requests',
  blockAllMixedContent: 'block-all-mixed-content',
};

/**
 * Serialise a {@link CspDirectives} object into a valid CSP header value.
 *
 * @example
 * ```ts
 * const csp = serializeCsp({
 *   defaultSrc: ["'self'"],
 *   scriptSrc: ["'self'", LUMENFLOW_CDN],
 *   upgradeInsecureRequests: true,
 * });
 * // "default-src 'self'; script-src 'self' https://assets.lumenflow.io; upgrade-insecure-requests"
 * ```
 */
export function serializeCsp(directives: CspDirectives): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(directives) as [keyof CspDirectives, unknown][]) {
    const directive = DIRECTIVE_MAP[key];
    if (directive === undefined) continue;

    if (typeof value === 'boolean') {
      if (value) parts.push(directive);
    } else if (Array.isArray(value) && value.length > 0) {
      parts.push(`${directive} ${(value as string[]).join(' ')}`);
    }
  }

  return parts.join('; ');
}

export interface CspPolicyOptions {
  /**
   * Nonce to allow a specific inline script block.  The matching
   * `<script nonce="...">` attribute must be set server-side.
   * When provided, `'self'` alone covers trusted first-party scripts.
   */
  nonce?: string;
  /** Allow loading assets from the Stellar CDN (jsdelivr). Default: false. */
  includeStellarCdn?: boolean;
  /** Allow loading assets from the LumenFlow CDN. Default: true. */
  includeLumenflowCdn?: boolean;
  /** Additional connect-src origins (e.g. RPC/Horizon endpoints). */
  extraConnectSrc?: string[];
  /** When true, allow data: URIs in img-src. Default: true. */
  allowDataImages?: boolean;
}

/**
 * Build a strict, CSP-compatible asset policy for the LumenFlow dashboard.
 *
 * The returned policy:
 * - Has no `unsafe-inline` or `unsafe-eval`.
 * - Uses a nonce for any legitimate inline scripts.
 * - Locks down `frame-ancestors` and `object-src` to `'none'`.
 * - Adds `upgrade-insecure-requests`.
 */
export function buildDashboardCspPolicy(options: CspPolicyOptions = {}): CspDirectives {
  const {
    nonce,
    includeStellarCdn = false,
    includeLumenflowCdn = true,
    extraConnectSrc = [],
    allowDataImages = true,
  } = options;

  const scriptSources: CspSources = ["'self'"];
  if (nonce) scriptSources.push(`'nonce-${nonce}'`);
  if (includeLumenflowCdn) scriptSources.push(LUMENFLOW_CDN);
  if (includeStellarCdn) scriptSources.push(STELLAR_CDN);

  const styleSources: CspSources = ["'self'"];
  if (includeLumenflowCdn) styleSources.push(LUMENFLOW_CDN);

  const fontSources: CspSources = ["'self'"];
  if (includeLumenflowCdn) fontSources.push(LUMENFLOW_CDN);

  const imgSources: CspSources = ["'self'"];
  if (allowDataImages) imgSources.push('data:');
  if (includeLumenflowCdn) imgSources.push(LUMENFLOW_CDN);

  const connectSources: CspSources = ["'self'", ...extraConnectSrc];

  return {
    defaultSrc: ["'self'"],
    scriptSrc: scriptSources,
    styleSrc: styleSources,
    fontSrc: fontSources,
    imgSrc: imgSources,
    connectSrc: connectSources,
    objectSrc: ["'none'"],
    frameSrc: ["'none'"],
    frameAncestors: ["'none'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    upgradeInsecureRequests: true,
  };
}

/**
 * Build the full `Content-Security-Policy` header value for the dashboard.
 * Convenience wrapper around {@link buildDashboardCspPolicy} + {@link serializeCsp}.
 */
export function buildDashboardCspHeader(options: CspPolicyOptions = {}): string {
  return serializeCsp(buildDashboardCspPolicy(options));
}
