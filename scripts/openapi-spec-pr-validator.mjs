export function validateOpenApiSpecContract(input) {
  if (!input || typeof input.subjectId !== 'string' || input.subjectId.trim() === '') {
    throw new Error('validateOpenApiSpecContract: subjectId must be a non-empty string');
  }
  const primary = Math.max(0, Math.trunc(Number(input.primaryCount ?? 0)));
  const secondary = Math.max(0, Math.trunc(Number(input.secondaryCount ?? 0)));
  const threshold = Math.max(1, Math.trunc(Number(input.thresholdLimit ?? 100)));

  const scoreBps = Math.min(10000, Math.round(((primary + secondary) * 10000) / threshold));
  let status = 'healthy';
  if (scoreBps >= 8500) {
    status = 'critical';
  } else if (scoreBps >= 5000) {
    status = 'warning';
  }

  return {
    subjectId: input.subjectId.trim(),
    primaryCount: primary,
    secondaryCount: secondary,
    scoreBps,
    status,
  };
}
