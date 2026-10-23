# Build Artifact Retention & Cleanup

## S3 Backup Retention

The reusable Terraform S3 module applies a lifecycle rule to objects under
`backups/`. By default, current and noncurrent object versions transition to
S3 Glacier after 30 days and expire after 365 days. The module's
`backup_lifecycle` input can override the prefix and both retention periods.
Expiration must be greater than the transition age.

The lifecycle configuration is managed by Terraform, so applying the updated
module updates the rule on its bucket, including buckets already in Terraform
state. Objects outside the configured backup prefix are unaffected by this
rule.

## CI Artifact Retention

The LumenFlow CI pipeline uploads the compiled WASM binary as a GitHub Actions artifact after every successful build.

| Artifact | Job | Retention |
|---|---|---|
| `lumenflow-wasm` (`lumenflow.wasm`) | `build` | **30 days** |

This is configured in `.github/workflows/ci.yml`:

```yaml
- name: Upload WASM artifact
  uses: actions/upload-artifact@v4
  with:
    name: lumenflow-wasm
    path: target/wasm32-unknown-unknown/release/lumenflow.wasm
    retention-days: 30
```

After 30 days, GitHub automatically deletes the artifact. You can also delete artifacts manually from the **Actions → workflow run → Artifacts** section in the GitHub UI, or via the GitHub CLI:

```bash
# List artifacts for a run
gh api repos/Gloriachinedu/lumenflow-contracts/actions/artifacts

# Delete a specific artifact by ID
gh api --method DELETE repos/Gloriachinedu/lumenflow-contracts/actions/artifacts/<artifact-id>
```

## Local Build Artifact Cleanup

Cargo writes build outputs to the `target/` directory. Over time this can grow to several gigabytes.

### Remove all build output

```bash
cargo clean
```

### Remove only the WASM release build

```bash
rm -rf target/wasm32-unknown-unknown/release/lumenflow.wasm
```

### Remove only the debug build

```bash
rm -rf target/debug
```

### Check disk usage before cleaning

```bash
du -sh target/
```

> **Tip:** `target/` is listed in `.gitignore` and is never committed. It is safe to delete at any time — Cargo will rebuild from source on the next `cargo build`.
