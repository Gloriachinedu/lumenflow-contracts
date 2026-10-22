#!/usr/bin/env bash
# scripts/check-benchmark-regression.sh
#
# Runs cargo bench for the lumenflow contract, compares each measured result
# against the baseline in contracts/lumenflow/benches/benchmark_baseline.json,
# and fails with exit code 1 if any benchmark exceeds
#   baseline_mean × (1 + threshold_percent / 100).
#
# Outputs:
#   • A summary table to stdout.
#   • A markdown-formatted comment block to benchmark-results.md (suitable for
#     posting as a PR comment via actions/github-script).
#
# Usage:
#   ./scripts/check-benchmark-regression.sh
#
# Requirements:
#   • cargo (Rust toolchain)
#   • jq  ≥ 1.6
#   • python3 or awk for arithmetic (uses awk for portability)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BASELINE_FILE="${REPO_ROOT}/contracts/lumenflow/benches/benchmark_baseline.json"
BENCH_OUTPUT_FILE="${REPO_ROOT}/bench_raw_output.txt"
RESULTS_MD="${REPO_ROOT}/benchmark-results.md"

# ── Validate prerequisites ─────────────────────────────────────────────────

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not found. Install it with: apt-get install jq" >&2
  exit 1
fi

if [[ ! -f "${BASELINE_FILE}" ]]; then
  echo "ERROR: baseline file not found at ${BASELINE_FILE}" >&2
  exit 1
fi

# ── Run benchmarks ─────────────────────────────────────────────────────────

echo "==> Running cargo bench (this may take a few minutes)…"
cargo bench \
  --manifest-path "${REPO_ROOT}/contracts/lumenflow/Cargo.toml" \
  2>&1 | tee "${BENCH_OUTPUT_FILE}"

echo ""
echo "==> Comparing results against baseline…"
echo ""

# ── Parse and compare ──────────────────────────────────────────────────────
#
# Criterion outputs lines like:
#   process_payment_with_signature
#                   time:   [44.321 µs 45.123 µs 45.987 µs]
#
# We extract the middle value (mean) from each "time:" line and look up the
# benchmark name from the preceding identifier line.
#
# Supported time units: ns, µs (us), ms, s.

OVERALL_STATUS=0
RESULT_ROWS=()

# Read baseline entries.
BENCH_NAMES=$(jq -r '.benchmarks | keys[]' "${BASELINE_FILE}")

for bench_name in ${BENCH_NAMES}; do
  baseline_mean=$(jq -r ".benchmarks[\"${bench_name}\"].mean_ns" "${BASELINE_FILE}")
  threshold=$(jq -r ".benchmarks[\"${bench_name}\"].threshold_percent" "${BASELINE_FILE}")

  # Look for the criterion output block for this benchmark name.
  # The "time:" line immediately follows the benchmark name.
  # Extract the mean (middle value) from:  [lower mean upper]
  time_line=$(grep -A5 "^${bench_name}$" "${BENCH_OUTPUT_FILE}" 2>/dev/null \
              | grep "time:" | head -1 || true)

  if [[ -z "${time_line}" ]]; then
    echo "  WARNING: No criterion output found for '${bench_name}'. Skipping." >&2
    RESULT_ROWS+=("| ${bench_name} | ${baseline_mean} ns | N/A | ⚠️ not found | — |")
    continue
  fi

  # Extract the three bracketed numbers (criterion outputs lower, mean, upper).
  # Example: "  time:   [44.321 µs 45.123 µs 45.987 µs]"
  # We want the second number (mean).
  raw_mean=$(echo "${time_line}" | grep -oP '\[\K[^\]]+' | head -1 | awk '{print $3, $4}')
  raw_value=$(echo "${raw_mean}" | awk '{print $1}')
  raw_unit=$(echo "${raw_mean}"  | awk '{print $2}')

  # Convert to nanoseconds.
  case "${raw_unit}" in
    ns)          measured_ns=$(awk "BEGIN{printf \"%.0f\", ${raw_value}}") ;;
    "µs"|us)     measured_ns=$(awk "BEGIN{printf \"%.0f\", ${raw_value} * 1000}") ;;
    ms)          measured_ns=$(awk "BEGIN{printf \"%.0f\", ${raw_value} * 1000000}") ;;
    s)           measured_ns=$(awk "BEGIN{printf \"%.0f\", ${raw_value} * 1000000000}") ;;
    *)
      echo "  WARNING: Unknown time unit '${raw_unit}' for '${bench_name}'. Skipping." >&2
      RESULT_ROWS+=("| ${bench_name} | ${baseline_mean} ns | N/A | ⚠️ unknown unit | — |")
      continue
      ;;
  esac

  # Compute maximum allowed ns.
  max_ns=$(awk "BEGIN{printf \"%.0f\", ${baseline_mean} * (1 + ${threshold} / 100)}")

  # Compute percent change vs baseline.
  pct_change=$(awk "BEGIN{printf \"%+.1f\", (${measured_ns} - ${baseline_mean}) / ${baseline_mean} * 100}")

  if [[ "${measured_ns}" -gt "${max_ns}" ]]; then
    status="❌ REGRESSION"
    OVERALL_STATUS=1
  elif [[ "${measured_ns}" -lt "${baseline_mean}" ]]; then
    status="✅ improved"
  else
    status="✅ ok"
  fi

  echo "  ${bench_name}: ${measured_ns} ns (baseline ${baseline_mean} ns, limit ${max_ns} ns) → ${pct_change}% — ${status}"
  RESULT_ROWS+=("| \`${bench_name}\` | ${baseline_mean} ns | ${measured_ns} ns | ${pct_change}% | ${status} |")
done

# ── Write markdown results file ────────────────────────────────────────────

UPDATED_AT=$(jq -r '.updated_at' "${BASELINE_FILE}")
RUN_DATE=$(date -u +"%Y-%m-%d %H:%M UTC")

{
  echo "## Benchmark Regression Report"
  echo ""
  echo "> Generated: ${RUN_DATE}"
  echo "> Baseline version: \`${UPDATED_AT}\` — \`contracts/lumenflow/benches/benchmark_baseline.json\`"
  echo "> Regression threshold: **10%** above baseline mean"
  echo ""
  if [[ "${OVERALL_STATUS}" -eq 0 ]]; then
    echo "**Result: ✅ No regressions detected.**"
  else
    echo "**Result: ❌ One or more benchmarks exceeded the regression threshold.**"
  fi
  echo ""
  echo "| Benchmark | Baseline | Measured | Change | Status |"
  echo "|-----------|----------|----------|--------|--------|"
  for row in "${RESULT_ROWS[@]}"; do
    echo "${row}"
  done
  echo ""
  echo "To update the baseline after an intentional performance change, run:"
  echo "\`\`\`bash"
  echo "./scripts/update-benchmark-baseline.sh"
  echo "\`\`\`"
} > "${RESULTS_MD}"

echo ""
echo "==> Results written to ${RESULTS_MD}"
echo ""

# ── Final summary ──────────────────────────────────────────────────────────

if [[ "${OVERALL_STATUS}" -ne 0 ]]; then
  echo "FAIL: One or more benchmarks regressed beyond the ${threshold}% threshold." >&2
  echo "      Review ${RESULTS_MD} for details." >&2
  exit 1
else
  echo "PASS: All benchmarks within acceptable range."
fi
