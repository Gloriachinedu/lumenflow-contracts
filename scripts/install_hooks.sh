#!/usr/bin/env bash
# Installs local git hooks from .githooks/ into the repository's hook directory.
# Run once after cloning:  ./scripts/install_hooks.sh
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

# Install all hooks
install_hook "pre-commit"
install_hook "commit-msg"

echo ""
echo "✅ Git hooks installed. Commit messages must follow Conventional Commits format."
echo "   See CONTRIBUTING.md for the commit message format."
