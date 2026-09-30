/**
 * cspAssetPolicy.test.ts
 *
 * Unit tests for CSP nonce injection helpers.
 * Tests run in a jsdom environment (browser-like) unless explicitly testing
 * the Node.js no-op path.
 */

import { CspNonceManager, cspNonceManager } from "./cspAssetPolicy";
import { LumenFlowClient } from "./client";

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
