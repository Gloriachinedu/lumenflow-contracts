import packageJson from "../package.json";

export const VERSION: string = packageJson.version;

export * from "./client";
export * from "./errors";
export * from "./signPaymentPayload";
export * from "./wallet";
