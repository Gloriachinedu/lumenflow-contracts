#!/usr/bin/env bash
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

hook_source="$repo_root/.githooks/pre-commit"
hook_target="$git_dir/hooks/pre-commit"

chmod +x "$hook_source"
ln -sf "$hook_source" "$hook_target"

echo "Installed git pre-commit hook at $hook_target"
