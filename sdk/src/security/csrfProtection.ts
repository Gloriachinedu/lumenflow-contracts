/**
 * CSRF protection utilities for web-based SDK consumers.
 */

/**
 * Generates a random CSRF token.
 */
export function generateCsrfToken(): string {
  const array = new Uint8Array(32);
  if (typeof globalThis.crypto !== "undefined") {
    globalThis.crypto.getRandomValues(array);
  } else {
    // Node.js fallback
    const { randomFillSync } = require("crypto");
    randomFillSync(array);
  }
  return Array.from(array)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Validates a CSRF token against a stored expected value.
 */
export function validateCsrfToken(token: string, expected: string): boolean {
  return token === expected;
}
