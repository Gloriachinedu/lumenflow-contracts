/**
 * Abuse detection module.
 * Detects and flags potentially abusive payment patterns.
 */
export interface AbuseDetectionOptions {
  maxRequestsPerMinute?: number;
}

export function createAbuseDetector(options: AbuseDetectionOptions = {}) {
  const { maxRequestsPerMinute = 60 } = options;
  const timestamps: number[] = [];

  return {
    check(): boolean {
      const now = Date.now();
      const windowStart = now - 60_000;
      // Remove timestamps outside the window
      while (timestamps.length > 0 && timestamps[0] < windowStart) {
        timestamps.shift();
      }
      timestamps.push(now);
      return timestamps.length <= maxRequestsPerMinute;
    },
    reset() {
      timestamps.length = 0;
    },
  };
}
