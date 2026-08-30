# Release Workflow

Releases are automated via `.github/workflows/release.yml` and triggered by pushing a semver tag.

## How to cut a release

1. **Update versions** — bump the version in **both** of these files to the same value:
   - `contracts/lumenflow/Cargo.toml` → `version = "X.Y.Z"`
   - `sdk/package.json` → `"version": "X.Y.Z"`

2. **Update CHANGELOG.md** with the release notes for this version.

3. **Commit and push** the version bump:
   ```bash
   git add contracts/lumenflow/Cargo.toml sdk/package.json CHANGELOG.md
   git commit -m "chore: release vX.Y.Z"
   git push origin main
   ```

4. **Push the tag**:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

## Tag format

| Pattern | Example | `prerelease` flag |
|---------|---------|-------------------|
| `vMAJOR.MINOR.PATCH` | `v1.2.3` | false |
| `vMAJOR.MINOR.PATCH-rc.N` | `v1.2.3-rc.1` | true |
| `vMAJOR.MINOR.PATCH-beta.N` | `v1.2.3-beta.1` | true |
| `vMAJOR.MINOR.PATCH-alpha.N` | `v1.2.3-alpha.1` | true |

## What the workflow does

1. **validate-tag** job — fails the release early if the tag version does not match
   `contracts/lumenflow/Cargo.toml` or `sdk/package.json`. This prevents mismatched
   release artefacts.

2. **release** job (runs after validation passes):
   - Builds the WASM artefact with `cargo build --locked --release`.
   - Enforces the 100 KB WASM size limit.
   - Creates a GitHub Release with auto-generated release notes
     (`generate_release_notes: true`) and uploads the `.wasm` file.
   - Marks the release as a pre-release automatically for `-rc`, `-beta`, and `-alpha` tags.
