#!/usr/bin/env bash
# apply-branch-protection.sh
# Applies the branch protection policy defined in .github/branch-protection.json
# to the main branch of the repository.
#
# Prerequisites:
#   - gh CLI authenticated (gh auth login)
#   - Caller must have admin rights on the repository
#
# Usage:
#   REPO=Gloriachinedu/lumenflow-contracts ./scripts/apply-branch-protection.sh

set -euo pipefail

REPO="${REPO:-Gloriachinedu/lumenflow-contracts}"
BRANCH="main"
POLICY="${POLICY:-.github/branch-protection.json}"

if [[ ! -f "$POLICY" ]]; then
  echo "ERROR: Policy file not found: $POLICY" >&2
  exit 1
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not found. Install it and run 'gh auth login'." >&2
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "ERROR: jq not found. Install jq to build the API payload." >&2
  exit 1
fi

echo "Applying branch protection to '${BRANCH}' on ${REPO} ..."
echo "Using policy: ${POLICY}"

# Required status checks that must always be enforced, in addition to any
# checks already declared in the policy file.
REQUIRED_CONTEXTS=(
  "CI"
  "coverage"
  "security scan"
  "OpenAPI validation"
)

# Merge the mandatory contexts with those from the policy file (deduplicated,
# order preserved) so the policy file remains the single source of truth while
# guaranteeing the required checks are present.
CONTEXTS_JSON="$(
  jq -c --argjson required "$(printf '%s\n' "${REQUIRED_CONTEXTS[@]}" | jq -R . | jq -s .)" '
    (.required_status_checks.contexts // []) as $existing
    | ($required + $existing)
    | reduce .[] as $c ([]; if index($c) then . else . + [$c] end)
  ' "$POLICY"
)"

# Build the GitHub API payload from the policy document, overriding the
# status check contexts and enforcing the required review/force-push rules.
PAYLOAD="$(
  jq -c \
    --argjson contexts "$CONTEXTS_JSON" '
    .required_status_checks = ((.required_status_checks // {}) + {
      strict: (.required_status_checks.strict // true),
      contexts: $contexts
    })
    | .enforce_admins = (.enforce_admins // true)
    | .required_pull_request_reviews = ((.required_pull_request_reviews // {}) + {
      required_approving_review_count: (
        [(.required_pull_request_reviews.required_approving_review_count // 1), 1] | max
      ),
      dismiss_stale_reviews: true
    })
    | .allow_force_pushes = false
    | .allow_deletions = (.allow_deletions // false)
    | .restrictions = (.restrictions // null)
  ' "$POLICY"
)"

gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "/repos/${REPO}/branches/${BRANCH}/protection" \
  --input - <<<"$PAYLOAD"

echo "Branch protection applied successfully."
echo "Verify at: https://github.com/${REPO}/settings/branches"
