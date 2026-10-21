export * from "./client";
export * from "./types";
export * from "./errors";
export * from "./signPaymentPayload";
export * from "./wallet";

// Explicit named re-export for MerchantCategory so SDK consumers get
// autocomplete and type-safety without importing from internal paths.
export { MerchantCategory } from "./types";
