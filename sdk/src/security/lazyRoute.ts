/**
 * Lazy-loading routes for optional security modules.
 *
 * Security modules are loaded via dynamic import() only when first accessed,
 * keeping the initial bundle lean for consumers that don't use them.
 *
 * Usage:
 *   const { createAbuseDetector } = await security.abuseDetection();
 *   const { encrypt, decrypt }    = await security.dataEncryption();
 *   const { generateCsrfToken }   = await security.csrfProtection();
 *   const { RateLimiter }         = await security.rateLimiter();
 */

type LazyModule<T> = () => Promise<T>;

function once<T>(loader: LazyModule<T>): LazyModule<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (!cached) {
      cached = loader();
    }
    return cached;
  };
}

export const security = {
  /** Lazy-load the abuse detection module */
  abuseDetection: once(
    () => import("./abuseDetection") as Promise<typeof import("./abuseDetection")>
  ),

  /** Lazy-load the data encryption module */
  dataEncryption: once(
    () => import("./dataEncryption") as Promise<typeof import("./dataEncryption")>
  ),

  /** Lazy-load the CSRF protection module */
  csrfProtection: once(
    () => import("./csrfProtection") as Promise<typeof import("./csrfProtection")>
  ),

  /** Lazy-load the rate limiter module */
  rateLimiter: once(
    () => import("./rateLimiter") as Promise<typeof import("./rateLimiter")>
  ),
};
