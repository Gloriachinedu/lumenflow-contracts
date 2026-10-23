#!/usr/bin/env bash
# scripts/update-benchmark-baseline.sh
#
# Re-runs cargo bench for the lumenflow contract and updates the baseline file
# at contracts/lumenflow/benches/benchmark_baseline.json with the new measured
# mean values.
#
# Use this script when:
#   • An intentional performance improvement has been made and the baseline
#     should reflect the new, faster measurements.
#   • The benchmark harness has changed (new benchmarks added, renamed, etc.)
#     and the baseline needs to be regenerated.
#
# After updating, commit the new baseline file alongside the change that
# caused it:
#
#   git add contracts/lumenflow/benches/benchmark_baseline.json
#   git commit -m "perf: update benchmark baseline after <description>"
#
# Requirements:
#   • cargo (Rust toolchain)
#   • jq  ≥ 1.6
#
# Usage:
#   ./scripts/update-benchmark-baseline.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BASELINE_FILE="${REPO_ROOT}/contracts/lumenflow/benches/benchmark_baseline.json"
BENCH_OUTPUT_FILE="${REPO_ROOT}/bench_raw_output.txt"

# ── Validate prerequisites ─────────────────────────────────────────────────

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required but not found. Install it with: apt-get install jq" >&2
  exit 1
fi

if [[ ! -f "${BASELINE_FILE}" ]]; then
  echo "ERROR: baseline file not found at ${BASELINE_FILE}" >&2
  exit 1
fi

echo "==> Running cargo bench to collect new measurements…"
echo "    (This may take a few minutes.)"
cargo bench \
  --manifest-path "${REPO_ROOT}/contracts/lumenflow/Cargo.toml" \
  2>&1 | tee "${BENCH_OUTPUT_FILE}"

echo ""
echo "==> Parsing results and updating baseline…"

TODAY=$(date -u +"%Y-%m-%d")

# Read existing baseline so we can preserve threshold_percent and version.
EXISTING_JSON=$(cat "${BASELINE_FILE}")
NEW_VERSION=$(echo "${EXISTING_JSON}" | jq '.version // 1')

# ── Build a new benchmarks object by updating each known key ──────────────

BENCH_NAMES=$(echo "${EXISTING_JSON}" | jq -r '.benchmarks | keys[]')

NEW_JSON=$(echo "${EXISTING_JSON}")

for bench_name in ${BENCH_NAMES}; do
  threshold=$(echo "${EXISTING_JSON}" | jq -r ".benchmarks[\"${bench_name}\"].threshold_percent")

  # Extract the criterion mean time line for this benchmark.
  time_line=$(grep -A5 "^${bench_name}$" "${BENCH_OUTPUT_FILE}" 2>/dev/null \
              | grep "time:" | head -1 || true)

  if [[ -z "${time_line}" ]]; then
    echo "  WARNING: No criterion output found for '${bench_name}'. Keeping existing baseline." >&2
    continue
  fi

  raw_mean=$(echo "${time_line}" | grep -oP '\[\K[^\]]+' | head -1 | awk '{print $3, $4}')
  raw_value=$(echo "${raw_mean}" | awk '{print $1}')
  raw_unit=$(echo "${raw_mean}"  | awk '{print $2}')

  # Convert to nanoseconds.
  case "${raw_unit}" in
    ns)          new_mean_ns=$(awk "BEGIN{printf \"%.0f\", ${raw_value}}") ;;
    "µs"|us)     new_mean_ns=$(awk "BEGIN{printf \"%.0f\", ${raw_value} * 1000}") ;;
    ms)          new_mean_ns=$(awk "BEGIN{printf \"%.0f\", ${raw_value} * 1000000}") ;;
    s)           new_mean_ns=$(awk "BEGIN{printf \"%.0f\", ${raw_value} * 1000000000}") ;;
    *)
      echo "  WARNING: Unknown time unit '${raw_unit}' for '${bench_name}'. Keeping existing baseline." >&2
      continue
      ;;
  esac

  OLD_MEAN=$(echo "${EXISTING_JSON}" | jq -r ".benchmarks[\"${bench_name}\"].mean_ns")
  PCT_CHANGE=$(awk "BEGIN{printf \"%+.1f\", (${new_mean_ns} - ${OLD_MEAN}) / ${OLD_MEAN} * 100}")
  echo "  ${bench_name}: ${OLD_MEAN} ns → ${new_mean_ns} ns (${PCT_CHANGE}%)"

  # Update the mean_ns in-place, preserving threshold_percent.
  NEW_JSON=$(echo "${NEW_JSON}" | jq \
    --arg name "${bench_name}" \
    --argjson mean "${new_mean_ns}" \
    '.benchmarks[$name].mean_ns = $mean')
done

# Update metadata fields.
NEW_JSON=$(echo "${NEW_JSON}" | jq \
  --arg date "${TODAY}" \
  '.updated_at = $date')

# ── Write updated file ─────────────────────────────────────────────────────

echo "${NEW_JSON}" > "${BASELINE_FILE}"

echo ""
echo "==> Baseline updated: ${BASELINE_FILE}"
echo ""
echo "Next steps:"
echo "  1. Review the changes: git diff contracts/lumenflow/benches/benchmark_baseline.json"
echo "  2. Stage and commit alongside the change that caused the improvement:"
echo "     git add contracts/lumenflow/benches/benchmark_baseline.json"
echo "     git commit -m \"perf: update benchmark baseline\""
echo ""

# Clean up raw output.
rm -f "${BENCH_OUTPUT_FILE}"
