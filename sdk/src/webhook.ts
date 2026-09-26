import { createHmac, timingSafeEqual } from "crypto";

const SIGNATURE_PATTERN = /^sha256=([a-f0-9]{64})$/i;

export function verifyWebhookSignature(
  payload: Buffer,
  signature: string,
  secret: string,
): boolean {
  if (!secret) {
    throw new Error("Webhook secret must not be empty");
  }

  const match = SIGNATURE_PATTERN.exec(signature);
  if (!match) {
    throw new Error("Webhook signature must use the format sha256=<64 hex characters>");
  }

  const expected = createHmac("sha256", secret).update(payload).digest();
  const received = Buffer.from(match[1], "hex");
  return timingSafeEqual(expected, received);
}
