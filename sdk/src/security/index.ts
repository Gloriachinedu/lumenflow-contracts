// Security utilities — see docs/security/security-controls.md
export * from "./securityHeaders";
export * from "./rateLimiter";
export * from "./abuseDetection";
export * from "./multisigControls";
export * from "./dataEncryption";
export * from "./fieldMinimization";
export * from "./dataDeletion";
export * from "./csrfProtection";
export * from "./logRedaction";

// GDPR right-to-erasure workflow (issue #1602).
// `export * from "./dataDeletion"` above already re-exports the erasure
// workflow (requestErasure, executeErasure, and related types) since they are
// declared as top-level named exports in that module. The explicit re-exports
// below guarantee the public surface stays stable even if those symbols are
// later moved under a namespace or re-exported indirectly.
export {
  requestErasure,
  executeErasure,
} from "./dataDeletion";
export type {
  ErasureRequest,
  ErasureRequestStatus,
  ErasureResult,
  ErasureAuditLogEntry,
} from "./dataDeletion";