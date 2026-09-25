/**
 * client.ts
 *
 * Top-level LumenFlow SDK client.
 */

import { cspNonceManager } from "./cspAssetPolicy";

export class LumenFlowClient {
  /**
   * Store a server-generated CSP nonce for use in SDK-created inline scripts.
   *
   * Call this method once per page load, passing the nonce value that appears
   * in the page's `Content-Security-Policy: script-src 'nonce-<value>'` header.
   *
   * In Node.js environments this method is a no-op.
   *
   * @param nonce - The CSP nonce string emitted by your server.
   *
   * @example
   * ```ts
   * const client = new LumenFlowClient();
   * client.setCspNonce(window.__CSP_NONCE__);
   * ```
   */
  setCspNonce(nonce: string): void {
    cspNonceManager.setNonce(nonce);
  }
}
