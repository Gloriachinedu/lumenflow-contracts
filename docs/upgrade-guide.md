# Contract Upgrade Guide

## Client version checks

Client-version checks are not currently implemented in this contract. In this
repository revision, `get_contract_version` and a `lumenflow/version_mismatch`
event are not defined. The contract crate is versioned `1.0.0`; that package
version alone does not define which client versions are compatible with a
particular deployed contract.

Do not add a positional `client_version` parameter to an existing exported
Soroban method to make it optional. Contract clients encode arguments against
the exported method ABI, so changing an existing method's argument list breaks
clients that call its current signature. Preserve existing entrypoints and use
an additive version-aware entrypoint (or another explicitly versioned request
interface) if version reporting is introduced.

Before implementing version warnings, maintainers need to define the contract
version source, the compatibility floor or range, and the event payload. The
version comparison must follow the selected version scheme rather than compare
version strings lexicographically. A mismatch should emit
`("lumenflow", "version_mismatch")` and must not reject the operation; calls
that omit a version through the legacy entrypoint remain supported.

The version-aware flow should be covered for compatible, incompatible, and
absent versions. Since the current repository has no version API or policy,
these decisions are prerequisites to adding that behavior.
