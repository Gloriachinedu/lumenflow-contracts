# Release Workflow

Releases are automated via `.github/workflows/release.yml` and triggered by pushing a semver tag.

## Changelog generation

`CHANGELOG.md` is generated automatically from conventional commit messages using
[`conventional-changelog-cli`](https://github.com/conventional-changelog/conventional-changelog)
and the custom preset defined in [`changelog.config.js`](../changelog.config.js).

### Commit message format

All commits that should appear in the changelog must follow the
[Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

Recognised types and the changelog sections they map to:

| Type | Changelog section |
|------|------------------|
| `feat` | 🚀 Features |
| `fix` | 🐛 Bug Fixes |
| `security` | 🔒 Security |
| `perf` | ⚡ Performance |
| `revert` | ⏪ Reverts |
| `docs` | 📝 Documentation |
| `ci` | 🤖 CI |
| `build` | 🔧 Build |

Commits with a `BREAKING CHANGE` footer note are grouped under ⚠ BREAKING CHANGES
at the top of the section regardless of their type.

Types not listed above (`chore`, `test`, `style`, `refactor`) are excluded from the
changelog by default.

### Automated generation in CI

When a semver tag is pushed, the `changelog` job in `.github/workflows/release.yml`
runs the following command against the full git history:

```bash
node_modules/.bin/conventional-changelog \
  -p conventionalcommits \
  -i CHANGELOG.md \
  -s \
  -r 0 \
  --config changelog.config.js
```

Flags:
- `-p conventionalcommits` — use the conventional-commits preset as a base.
- `-i CHANGELOG.md -s` — read from and write back to `CHANGELOG.md` in place.
- `-r 0` — regenerate the full changelog (all tags), not just the latest.
- `--config changelog.config.js` — apply the LumenFlow-specific grouping, emoji
  prefixes, and sort order defined in the config file.

The job then extracts the latest release section and embeds it as the GitHub Release
body, commits the updated `CHANGELOG.md` back to the release branch with a
`[skip ci]` commit, and outputs the body for use by the `release` job.

### Generating the changelog locally

Run the same command locally before cutting a release to preview the output:

```bash
# One-time install (pinned version matches CI)
npm install --no-save conventional-changelog-cli@5.0.0

# Regenerate CHANGELOG.md in place
npx conventional-changelog \
  -p conventionalcommits \
  -i CHANGELOG.md \
  -s \
  -r 0 \
  --config changelog.config.js
```

The `scripts/release.sh` helper also calls `conventional-changelog-cli` automatically
when it is available, falling back to a manual stub only when the tool is not installed:

```bash
./scripts/release.sh 1.2.0
```

---

## How to cut a release

1. **Update versions** — bump the version in **both** of these files to the same value:
   - `contracts/lumenflow/Cargo.toml` → `version = "X.Y.Z"`
   - `sdk/package.json` → `"version": "X.Y.Z"`

2. **Write conventional commits** — ensure all PR squash-merge commits for this
   release use the `<type>(<scope>): <subject>` format so the changelog is
   generated accurately. Do **not** manually edit `CHANGELOG.md`; it is regenerated
   automatically by CI.

3. **Run the release script** (optional local preview):
   ```bash
   ./scripts/release.sh X.Y.Z
   ```
   This bumps versions, regenerates `CHANGELOG.md` via `conventional-changelog-cli`,
   stages the files, creates a commit, and tags the release.

4. **Push the tag**:
   ```bash
   git push origin main && git push origin vX.Y.Z
   ```

   CI will regenerate `CHANGELOG.md` from the full commit history, commit it back
   to `main` with `[skip ci]`, and attach the latest section to the GitHub Release.

---

## Tag format

| Pattern | Example | `prerelease` flag |
|---------|---------|-------------------|
| `vMAJOR.MINOR.PATCH` | `v1.2.3` | false |
| `vMAJOR.MINOR.PATCH-rc.N` | `v1.2.3-rc.1` | true |
| `vMAJOR.MINOR.PATCH-beta.N` | `v1.2.3-beta.1` | true |
| `vMAJOR.MINOR.PATCH-alpha.N` | `v1.2.3-alpha.1` | true |

---

## What the workflow does

1. **validate-tag** job — fails the release early if the tag version does not match
   `contracts/lumenflow/Cargo.toml` or `sdk/package.json`. This prevents mismatched
   release artefacts.

2. **container-scan** job — runs [Trivy](https://github.com/aquasecurity/trivy) against
   every container image shipped in the project's compose stack
   (`stellar/quickstart:latest`, `ubuntu:22.04`). A fixable `CRITICAL` vulnerability
   in any image fails the release gate; results are also uploaded to the repository's
   **Security → Code scanning** tab as SARIF.

3. **changelog** job (runs after `validate-tag`):
   - Checks out the full git history (`fetch-depth: 0`).
   - Installs `conventional-changelog-cli@5.0.0`.
   - Regenerates `CHANGELOG.md` with `-r 0` (full history) using `changelog.config.js`.
   - Extracts the latest release section and stores it as the `changelog_body` output
     for use by the `release` job.
   - Commits the updated `CHANGELOG.md` back to the release branch with `[skip ci]`.

4. **release** job (runs after `changelog` and `container-scan` both pass):
   - Builds the WASM artefact with `cargo build --locked --release`.
   - Enforces the 100 KB WASM size limit.
   - Creates a GitHub Release using the `changelog_body` from the `changelog` job as
     the release description and uploads the `.wasm` and `.sha256` artefacts.
   - Marks the release as a pre-release automatically for `-rc`, `-beta`, and `-alpha` tags.
