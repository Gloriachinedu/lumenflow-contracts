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
POLICY=".github/branch-protection.json"

if [[ ! -f "$POLICY" ]]; then
  echo "ERROR: Policy file not found: $POLICY" >&2
  exit 1
fi

echo "Applying branch protection to '${BRANCH}' on ${REPO} ..."

# Build the GitHub API payload from the policy document
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "/repos/${REPO}/branches/${BRANCH}/protection" \
  --input - <<EOF
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["Lint", "Test", "Auth Tests", "Build WASM"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true,
  "required_linear_history": true
}
EOF

echo "Branch protection applied successfully."
echo "Verify at: https://github.com/${REPO}/settings/branches"
