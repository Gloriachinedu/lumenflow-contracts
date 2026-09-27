/**
 * Abuse detection for payment link and webhook endpoints (issue #899).
 *
 * Tracks per-source request behaviour and flags patterns that indicate
 * scraping, card-testing or webhook flooding:
 *   - high request volume in a short burst window
 *   - a high ratio of failed / rejected responses (card testing, probing)
 *   - repeated hits against many distinct payment links from one source
 *
 * The detector is advisory: it returns a verdict and a reason so the caller
 * decides whether to challenge, throttle or block.
 */

export type AbuseSeverity = "ok" | "suspicious" | "abusive";

export interface AbuseVerdict {
  severity: AbuseSeverity;
  /** Human-readable explanation, empty when `ok`. */
  reason: string;
}

export interface AbuseDetectorOptions {
  /** Burst window in ms over which requests are counted. Default: 10_000. */
  windowMs?: number;
  /** Requests within the window that mark a source `suspicious`. Default: 30. */
  suspiciousCount?: number;
  /** Requests within the window that mark a source `abusive`. Default: 60. */
  abusiveCount?: number;
  /**
   * Failure ratio (0..1) that marks a source `abusive` once it has made at
   * least `minSampleForRatio` requests. Default: 0.7.
   */
  failureRatio?: number;
  /** Minimum requests before the failure ratio is evaluated. Default: 10. */
  minSampleForRatio?: number;
  /** Distinct target resources in the window that mark a source `abusive`. Default: 20. */
  distinctTargets?: number;
  /** Injectable clock for testing. Default: `Date.now`. */
  now?: () => number;
}

export interface RequestSample {
  /** Stable identifier for the caller (IP, API key, wallet). */
  source: string;
  /** Payment-link id or webhook endpoint id being hit. */
  target: string;
  /** Whether the request was rejected (4xx/5xx, bad signature, declined). */
  failed: boolean;
}

interface Window {
  start: number;
  total: number;
  failed: number;
  targets: Set<string>;
}

export class AbuseDetector {
  private readonly opts: Required<Omit<AbuseDetectorOptions, "now">>;
  private readonly now: () => number;
  private readonly windows = new Map<string, Window>();

  constructor(options: AbuseDetectorOptions = {}) {
    this.now = options.now ?? Date.now;
    this.opts = {
      windowMs: options.windowMs ?? 10_000,
      suspiciousCount: options.suspiciousCount ?? 30,
      abusiveCount: options.abusiveCount ?? 60,
      failureRatio: options.failureRatio ?? 0.7,
      minSampleForRatio: options.minSampleForRatio ?? 10,
      distinctTargets: options.distinctTargets ?? 20,
    };
  }

  /** Record a request and return the current verdict for its source. */
  record(sample: RequestSample): AbuseVerdict {
    const t = this.now();
    let w = this.windows.get(sample.source);
    if (!w || t - w.start >= this.opts.windowMs) {
      w = { start: t, total: 0, failed: 0, targets: new Set() };
      this.windows.set(sample.source, w);
    }
    w.total += 1;
    if (sample.failed) w.failed += 1;
    w.targets.add(sample.target);

    return this.evaluate(w);
  }

  /** Current verdict for a source without recording a new request. */
  verdict(source: string): AbuseVerdict {
    const w = this.windows.get(source);
    if (!w || this.now() - w.start >= this.opts.windowMs) {
      return { severity: "ok", reason: "" };
    }
    return this.evaluate(w);
  }

  private evaluate(w: Window): AbuseVerdict {
    const o = this.opts;
    if (w.total >= o.abusiveCount) {
      return {
        severity: "abusive",
        reason: `${w.total} requests in ${o.windowMs}ms burst window`,
      };
    }
    if (w.targets.size >= o.distinctTargets) {
      return {
        severity: "abusive",
        reason: `${w.targets.size} distinct targets hit from one source`,
      };
    }
    if (
      w.total >= o.minSampleForRatio &&
      w.failed / w.total >= o.failureRatio
    ) {
      return {
        severity: "abusive",
        reason: `${Math.round((w.failed / w.total) * 100)}% failure rate over ${w.total} requests`,
      };
    }
    if (w.total >= o.suspiciousCount) {
      return {
        severity: "suspicious",
        reason: `${w.total} requests in ${o.windowMs}ms burst window`,
      };
    }
    return { severity: "ok", reason: "" };
  }

  /** Forget the tracked window for a source. */
  reset(source: string): void {
    this.windows.delete(source);
  }
}
