/**
 * cspAssetPolicy.test.ts
 *
 * Unit tests for CSP nonce injection helpers.
 * Tests run in a jsdom environment (browser-like) unless explicitly testing
 * the Node.js no-op path.
 */

import { CspNonceManager, cspNonceManager } from "./cspAssetPolicy";
import { LumenFlowClient } from "./client";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBrowserEnv(): void {
  // jsdom already sets window / document in a Jest jsdom environment.
  // This guard is here in case the test runner uses a node environment.
  if (typeof window === "undefined") {
    (global as Record<string, unknown>).window = global;
    (global as Record<string, unknown>).document = {
      createElement: (tag: string) => ({
        tag,
        textContent: "",
        nonce: "",
        setAttribute: (_: string, __: string) => undefined,
      }),
      head: { appendChild: (_: unknown) => undefined },
    };
  }
}

// ---------------------------------------------------------------------------
// CspNonceManager — browser context
// ---------------------------------------------------------------------------

describe("CspNonceManager (browser)", () => {
  let manager: CspNonceManager;

  beforeEach(() => {
    makeBrowserEnv();
    manager = new CspNonceManager();
  });

  it("returns null before any nonce is set", () => {
    expect(manager.getNonce()).toBeNull();
  });

  it("stores a nonce via setNonce()", () => {
    manager.setNonce("abc123");
    expect(manager.getNonce()).toBe("abc123");
  });

  it("overwrites a previously stored nonce", () => {
    manager.setNonce("first");
    manager.setNonce("second");
    expect(manager.getNonce()).toBe("second");
  });

  it("clearNonce() resets nonce to null", () => {
    manager.setNonce("abc123");
    manager.clearNonce();
    expect(manager.getNonce()).toBeNull();
  });

  it("createNoncedScript() sets the nonce property on the element", () => {
    manager.setNonce("test-nonce");
    const script = manager.createNoncedScript("console.log('hi')");
    expect(script).not.toBeNull();
    expect(script?.nonce).toBe("test-nonce");
  });

  it("createNoncedScript() sets textContent on the element", () => {
    manager.setNonce("n1");
    const script = manager.createNoncedScript("const x = 1;");
    expect(script?.textContent).toBe("const x = 1;");
  });

  it("createNoncedScript() returns an element even without a nonce", () => {
    // nonce is null — script element still created, just without a nonce
    const script = manager.createNoncedScript("const y = 2;");
    expect(script).not.toBeNull();
    expect(script?.nonce).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// CspNonceManager — Node.js (no-op) context
// ---------------------------------------------------------------------------

describe("CspNonceManager (Node.js no-op)", () => {
  let originalWindow: unknown;
  let originalDocument: unknown;

  beforeEach(() => {
    // Remove browser globals to simulate Node.js.
    originalWindow = (global as Record<string, unknown>).window;
    originalDocument = (global as Record<string, unknown>).document;
    delete (global as Record<string, unknown>).window;
    delete (global as Record<string, unknown>).document;
  });

  afterEach(() => {
    (global as Record<string, unknown>).window = originalWindow;
    (global as Record<string, unknown>).document = originalDocument;
  });

  it("setNonce() is a no-op and getNonce() stays null", () => {
    const manager = new CspNonceManager();
    manager.setNonce("server-nonce");
    // Because isBrowser() returns false, nonce should not be stored.
    expect(manager.getNonce()).toBeNull();
  });

  it("createNoncedScript() returns null", () => {
    const manager = new CspNonceManager();
    expect(manager.createNoncedScript("code")).toBeNull();
  });

  it("injectScript() does not throw", () => {
    const manager = new CspNonceManager();
    expect(() => manager.injectScript("code")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// LumenFlowClient.setCspNonce()
// ---------------------------------------------------------------------------

describe("LumenFlowClient.setCspNonce()", () => {
  beforeEach(() => {
    makeBrowserEnv();
    // Reset shared singleton between tests.
    cspNonceManager.clearNonce();
  });

  it("stores nonce on the shared cspNonceManager", () => {
    const client = new LumenFlowClient();
    client.setCspNonce("page-nonce-xyz");
    expect(cspNonceManager.getNonce()).toBe("page-nonce-xyz");
  });
});

// ---------------------------------------------------------------------------
// Frontend CSP policy enforcement
// ---------------------------------------------------------------------------

/**
 * The CSP policy that must be present in every frontend HTML page via a
 * `<meta http-equiv="Content-Security-Policy" content="...">` tag.
 *
 * Keep this in sync with the meta tags in the frontend HTML files.
 */
const FRONTEND_CSP_POLICY =
  "default-src 'self'; " +
  "script-src 'self'; " +
  "style-src 'self'; " +
  "img-src 'self' data:; " +
  "connect-src 'self'; " +
  "font-src 'self'; " +
  "object-src 'none'; " +
  "base-uri 'self'; " +
  "frame-ancestors 'none'; " +
  "form-action 'self'";

/** Frontend HTML pages that must carry the CSP meta tag. */
const FRONTEND_HTML_PAGES = [
  "index.html",
  "dashboard.html",
  "receipt.html",
];

/** Resolve the frontend directory relative to the repository root. */
function frontendDir(): string {
  // sdk/src -> sdk -> repo root -> frontend
  return path.resolve(__dirname, "..", "..", "frontend");
}

/** Extract the CSP meta tag content from an HTML document, if present. */
function extractCspMetaContent(html: string): string | null {
  const metaTagRegex = /<meta\b[^>]*>/gi;
  const tags = html.match(metaTagRegex) ?? [];
  for (const tag of tags) {
    const isCsp = /http-equiv\s*=\s*["']Content-Security-Policy["']/i.test(tag);
    if (!isCsp) continue;
    const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (contentMatch) return contentMatch[1];
  }
  return null;
}

describe("Frontend CSP policy", () => {
  it("restricts script-src to 'self' with no 'unsafe-inline'", () => {
    const scriptSrcMatch = FRONTEND_CSP_POLICY.match(/script-src([^;]*)/i);
    expect(scriptSrcMatch).not.toBeNull();
    const scriptSrc = scriptSrcMatch![1].trim();
    expect(scriptSrc).toBe("'self'");
    expect(FRONTEND_CSP_POLICY).not.toMatch(/script-src[^;]*'unsafe-inline'/i);
    expect(FRONTEND_CSP_POLICY).not.toMatch(/script-src[^;]*'unsafe-eval'/i);
  });

  it("includes object-src 'none'", () => {
    expect(FRONTEND_CSP_POLICY).toMatch(/object-src\s+'none'/i);
  });

  it("includes frame-ancestors 'none'", () => {
    expect(FRONTEND_CSP_POLICY).toMatch(/frame-ancestors\s+'none'/i);
  });

  it("does not allow 'unsafe-inline' anywhere in the policy", () => {
    expect(FRONTEND_CSP_POLICY).not.toMatch(/'unsafe-inline'/i);
  });

  describe.each(FRONTEND_HTML_PAGES)("%s", (page) => {
    const filePath = path.join(frontendDir(), page);
    let html: string;

    beforeAll(() => {
      html = fs.readFileSync(filePath, "utf8");
    });

    it("exists", () => {
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it("contains a Content-Security-Policy meta tag", () => {
      expect(extractCspMetaContent(html)).not.toBeNull();
    });

    it("meta tag content matches the frontend CSP policy", () => {
      const content = extractCspMetaContent(html);
      expect(content).not.toBeNull();
      // Normalise whitespace so formatting differences don't cause failures.
      const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
      expect(normalise(content!)).toBe(normalise(FRONTEND_CSP_POLICY));
    });

    it("meta tag restricts script-src to 'self'", () => {
      const content = extractCspMetaContent(html) ?? "";
      const scriptSrcMatch = content.match(/script-src([^;]*)/i);
      expect(scriptSrcMatch).not.toBeNull();
      expect(scriptSrcMatch![1].trim()).toBe("'self'");
      expect(content).not.toMatch(/script-src[^;]*'unsafe-inline'/i);
    });
  });
});
