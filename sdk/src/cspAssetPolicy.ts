/**
 * cspAssetPolicy.ts
 *
 * Content Security Policy (CSP) helpers for the LumenFlow browser SDK bundle.
 * Provides nonce injection for inline scripts so that host pages can apply a
 * server-generated nonce without relaxing their `script-src` directives.
 *
 * Node.js note: all DOM-related helpers are no-ops when `window` is undefined.
 */

/** Returns true when running in a browser context. */
function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

/**
 * Manages a single CSP nonce value for the lifetime of the SDK client.
 * This class is used internally by `LumenFlowClient` and is also exported
 * so host applications can integrate it standalone.
 */
export class CspNonceManager {
  private nonce: string | null = null;

  /**
   * Store a server-generated CSP nonce.
   *
   * In a Node.js environment this is a no-op (the nonce is silently ignored).
   *
   * @param nonce - The nonce value emitted in the page's `Content-Security-Policy`
   *   `script-src 'nonce-<value>'` directive.
   */
  setNonce(nonce: string): void {
    if (!isBrowser()) {
      // No-op outside browser environments.
      return;
    }
    this.nonce = nonce;
  }

  /**
   * Retrieve the currently stored nonce, or `null` if none has been set.
   */
  getNonce(): string | null {
    return this.nonce;
  }

  /**
   * Clear the stored nonce (e.g. after a page navigation).
   */
  clearNonce(): void {
    this.nonce = null;
  }

  /**
   * Create a `<script>` element with the stored nonce applied.
   *
   * Returns `null` outside browser environments.
   *
   * @param content - Inline script body.
   * @returns An `HTMLScriptElement` with the nonce attribute set, or `null`.
   */
  createNoncedScript(content: string): HTMLScriptElement | null {
    if (!isBrowser()) {
      return null;
    }

    const script = document.createElement("script");
    script.textContent = content;

    if (this.nonce !== null) {
      script.nonce = this.nonce;
      // Some older browsers read the attribute rather than the property.
      script.setAttribute("nonce", this.nonce);
    }

    return script;
  }

  /**
   * Inject an inline `<script>` block into the document `<head>`.
   *
   * No-op outside browser environments.
   *
   * @param content - Inline script body.
   */
  injectScript(content: string): void {
    const script = this.createNoncedScript(content);
    if (script !== null) {
      document.head.appendChild(script);
    }
  }
}

/** Shared singleton used by LumenFlowClient. */
export const cspNonceManager = new CspNonceManager();
