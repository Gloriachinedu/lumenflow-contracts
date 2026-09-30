/**
 * Multisig quorum and signer-replacement controls (issue #900).
 *
 * Client-side validation that runs before a multisig configuration or a
 * signer-replacement request is submitted to the LumenFlow contract. It
 * enforces the invariants the contract also checks, so callers get an early,
 * descriptive failure instead of a reverted transaction:
 *
 *   - quorum is at least 2 and never exceeds the signer count (no un-meetable
 *     or trivially-bypassable thresholds)
 *   - the signer set has no duplicates and no empty entries
 *   - replacing a signer keeps the set size and quorum consistent, cannot
 *     introduce a duplicate, and cannot drop the set below quorum
 *   - an already-executed payment can no longer be reconfigured
 */

export interface QuorumConfig {
  signers: string[];
  requiredSignatures: number;
}

export interface ValidationResult {
  valid: boolean;
  /** Reason for rejection, empty when `valid`. */
  error: string;
}

const OK: ValidationResult = { valid: true, error: "" };
const fail = (error: string): ValidationResult => ({ valid: false, error });

function checkSignerSet(signers: string[]): ValidationResult {
  if (!Array.isArray(signers) || signers.length === 0) {
    return fail("signer set must be a non-empty array");
  }
  if (signers.some((s) => typeof s !== "string" || s.trim() === "")) {
    return fail("signer set contains an empty or non-string entry");
  }
  if (new Set(signers).size !== signers.length) {
    return fail("signer set contains duplicate addresses");
  }
  return OK;
}

/**
 * Validate a proposed multisig quorum configuration.
 */
export function validateQuorumConfig(config: QuorumConfig): ValidationResult {
  const setCheck = checkSignerSet(config.signers);
  if (!setCheck.valid) return setCheck;

  const { requiredSignatures: q, signers } = config;
  if (!Number.isInteger(q)) {
    return fail("requiredSignatures must be an integer");
  }
  if (q < 2) {
    return fail("requiredSignatures must be at least 2 for a multisig payment");
  }
  if (q > signers.length) {
    return fail(
      `requiredSignatures (${q}) exceeds the number of signers (${signers.length})`
    );
  }
  return OK;
}

export interface SignerReplacement {
  currentSigners: string[];
  requiredSignatures: number;
  /** Signer address being removed. */
  outgoing: string;
  /** Signer address being added. */
  incoming: string;
  /** Addresses that have already signed the pending payment, if any. */
  signedBy?: string[];
  /** Whether the payment has already executed. */
  executed?: boolean;
}

/**
 * Validate a signer-replacement request against the current quorum state.
 */
export function validateSignerReplacement(
  req: SignerReplacement
): ValidationResult {
  if (req.executed) {
    return fail("cannot replace a signer on an executed payment");
  }

  const setCheck = checkSignerSet(req.currentSigners);
  if (!setCheck.valid) return setCheck;

  if (typeof req.incoming !== "string" || req.incoming.trim() === "") {
    return fail("incoming signer must be a non-empty address");
  }
  if (!req.currentSigners.includes(req.outgoing)) {
    return fail(`outgoing signer ${req.outgoing} is not in the current set`);
  }
  if (req.currentSigners.includes(req.incoming)) {
    return fail(`incoming signer ${req.incoming} is already in the set`);
  }
  if (req.outgoing === req.incoming) {
    return fail("outgoing and incoming signer are identical");
  }

  const nextSigners = req.currentSigners.map((s) =>
    s === req.outgoing ? req.incoming : s
  );

  const quorumCheck = validateQuorumConfig({
    signers: nextSigners,
    requiredSignatures: req.requiredSignatures,
  });
  if (!quorumCheck.valid) return quorumCheck;

  // The outgoing signer's prior approval must not count toward quorum.
  if (req.signedBy?.includes(req.outgoing)) {
    const remainingValidSignatures = req.signedBy.filter(
      (s) => s !== req.outgoing && nextSigners.includes(s)
    ).length;
    if (remainingValidSignatures < req.requiredSignatures) {
      return fail(
        "removing this signer drops valid signatures below the required quorum; " +
          "re-collect approvals after replacement"
      );
    }
  }

  return OK;
}
