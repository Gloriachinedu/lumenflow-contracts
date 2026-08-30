# Audit Report

## Audit Scope

This document captures the Soroban/Stellar smart contract security audit plan for LumenFlow.

Scope includes:

- Authorization model and access control
- Signature verification and payload validation
- Refund lifecycle and refund state transitions
- Multi-signature payment approval and execution
- Persistent storage and data integrity
- Arithmetic correctness and overflow protection

## Status

An auditor engagement is in progress. The full process — scope, firm selection
criteria, auditor handoff package, timeline, remediation SLAs, re-audit
triggers, and the mainnet deployment gate — is defined in
[**audit-engagement-plan.md**](audit-engagement-plan.md).

The audit findings and remediation tracking live in
[audit-report-v1.0.md](audit-report-v1.0.md). Readiness is machine-checked by
[`scripts/audit-readiness-check.sh`](../../scripts/audit-readiness-check.sh).

## Next steps

1. Complete firm selection per [audit-engagement-plan.md §3](audit-engagement-plan.md#3-firm-selection).
2. Deliver the auditor handoff package ([§4](audit-engagement-plan.md#4-auditor-handoff-package)).
3. Track all Critical and High findings in
   [audit-report-v1.0.md §9](audit-report-v1.0.md#9-remediation-tracking) and
   resolve them before mainnet deployment.
4. Clear every box in the [mainnet deployment gate](audit-engagement-plan.md#8-mainnet-deployment-gate)
   (`./scripts/audit-readiness-check.sh --mainnet` must exit 0).
5. Publish the final audit report in this directory with the firm's sign-off.
