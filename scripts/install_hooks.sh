#!/usr/bin/env bash
# Installs local git hooks from .githooks/ into the repository's hook directory.
# Run once after cloning:  ./scripts/install_hooks.sh
#
# The pre-commit hook runs a secret scanner (gitleaks or detect-secrets) to
# block accidental commits of private keys, API tokens, and webhook secrets.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"

if ! git -C "$repo_root" rev-parse --git-dir > /dev/null 2>&1; then
  echo "Error: not a git repository: $repo_root" >&2
  exit 1
fi

git_dir="$(git -C "$repo_root" rev-parse --git-dir)"
# If git_dir is relative, resolve it against the repo root.
if [[ "$git_dir" != /* ]]; then
  git_dir="$repo_root/$git_dir"
fi

hooks_source_dir="$repo_root/.githooks"
hooks_target_dir="$git_dir/hooks"

install_hook() {
  local name="$1"
  local source="$hooks_source_dir/$name"
  local target="$hooks_target_dir/$name"

  if [[ ! -f "$source" ]]; then
    echo "Warning: hook source not found: $source" >&2
    return
  fi

  chmod +x "$source"
  ln -sf "$source" "$target"
  echo "Installed git $name hook → $target"
}

# Detect an available secret scanner. The pre-commit hook prefers gitleaks
# (configured via .gitleaks.toml) and falls back to detect-secrets.
detect_scanner() {
  if command -v gitleaks > /dev/null 2>&1; then
    echo "gitleaks"
  elif command -v detect-secrets > /dev/null 2>&1; then
    echo "detect-secrets"
  else
    echo ""
  fi
}

scanner="$(detect_scanner)"

if [[ -z "$scanner" ]]; then
  echo "Warning: no secret scanner found (gitleaks or detect-secrets)." >&2
  echo "         The pre-commit hook will not be able to block committed credentials." >&2
  echo "         Install one of the following:" >&2
  echo "           - gitleaks:        https://github.com/gitleaks/gitleaks#installing" >&2
  echo "           - detect-secrets:  pip install detect-secrets" >&2
else
  echo "Detected secret scanner: $scanner"
fi

# Install all hooks
install_hook "pre-commit"
install_hook "commit-msg"

echo ""
echo "✅ Git hooks installed. Commit messages must follow Conventional Commits format."
echo "   See CONTRIBUTING.md for the commit message format."
if [[ -n "$scanner" ]]; then
  echo "   The pre-commit hook scans staged changes for secrets using $scanner."
else
  echo "   ⚠️  Install gitleaks or detect-secrets to enable secret scanning on commit."
fi