#!/usr/bin/env bash
# scripts/release.sh — bump version, update CHANGELOG, create signed tag
# Usage: ./scripts/release.sh <new-version>
# Example: ./scripts/release.sh 1.1.0
set -euo pipefail

VERSION="${1:-}"
if [[ -z "$VERSION" ]]; then
  echo "Usage: $0 <new-version>  (e.g. 1.1.0)" >&2
  exit 1
fi

# Validate semver format
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$ ]]; then
  echo "ERROR: '$VERSION' is not a valid semver string." >&2
  exit 1
fi

CARGO_TOML="contracts/lumenflow/Cargo.toml"
CHANGELOG="CHANGELOG.md"
TAG="v${VERSION}"
DATE=$(date -u +%Y-%m-%d)

# 1. Bump version in Cargo.toml
sed -i "s/^version = \".*\"/version = \"${VERSION}\"/" "$CARGO_TOML"
echo "Updated $CARGO_TOML -> version = \"${VERSION}\""

# 2. Regenerate Cargo.lock to reflect the new version
cargo update --workspace --locked 2>/dev/null || cargo generate-lockfile
echo "Cargo.lock updated"

# 3. Prepend release entry to CHANGELOG.md
TMPFILE=$(mktemp)
{
  echo "## [${VERSION}] - ${DATE}"
  echo ""
  echo "### Added"
  echo "- (fill in release notes)"
  echo ""
  echo "### Changed"
  echo "- (fill in changes)"
  echo ""
  echo "### Fixed"
  echo "- (fill in fixes)"
  echo ""
  cat "$CHANGELOG"
} > "$TMPFILE"
mv "$TMPFILE" "$CHANGELOG"
echo "Prepended entry to $CHANGELOG"

# 4. Stage changes
git add "$CARGO_TOML" "$CHANGELOG" Cargo.lock

# 5. Commit
git commit -m "chore: release ${TAG}"

# 6. Create signed tag (falls back to unsigned if GPG not configured)
if git config --get user.signingkey &>/dev/null; then
  git tag -s "$TAG" -m "Release ${TAG}"
  echo "Created signed tag $TAG"
else
  git tag -a "$TAG" -m "Release ${TAG}"
  echo "Created annotated tag $TAG (no GPG key configured)"
fi

echo ""
echo "Done. Push with:"
echo "  git push origin main && git push origin $TAG"
