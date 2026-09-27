import { createHmac } from "crypto";
import { verifyWebhookSignature } from "./webhook";

const payload = Buffer.from('{"event":"payment_processed"}');
const secret = "webhook-secret";
const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

describe("verifyWebhookSignature", () => {
  it("accepts a valid signature", () => {
    expect(verifyWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it("rejects a tampered payload and wrong secret", () => {
    expect(verifyWebhookSignature(Buffer.from("tampered"), signature, secret)).toBe(false);
    expect(verifyWebhookSignature(payload, signature, "wrong-secret")).toBe(false);
  });

  it("throws for an empty secret or malformed signature", () => {
    expect(() => verifyWebhookSignature(payload, signature, "")).toThrow();
    expect(() => verifyWebhookSignature(payload, "not-a-signature", secret)).toThrow();
  });
});
