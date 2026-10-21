# CI Artifact Retention

GitHub Actions artifacts use explicit retention periods based on their purpose:

| Artifact type | Retention |
| --- | ---: |
| Production release build artifacts | 90 days |
| Test and standard build artifacts | 30 days |
| Debug and coverage artifacts | 7 days |

Every `actions/upload-artifact` step must set `retention-days` according to
these tiers. The CI WASM build uses the 30-day period. The release workflow
keeps its staged WASM build artifact for 90 days; the separately published
GitHub Release asset follows GitHub Releases' retention and availability
behavior, not Actions artifact retention.

No debug or coverage artifacts are currently uploaded. If such uploads are
added, they must use 7 days. When adding a new artifact, classify it by its
purpose and set the matching retention explicitly rather than relying on the
repository or organization default.