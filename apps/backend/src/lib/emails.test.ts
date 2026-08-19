import { describe, expect, it } from "vitest";
import { emailOutboxIdForIdempotencyKey } from "./emails";

describe("email outbox idempotency", () => {
  it("derives retry-stable, recipient-distinct UUID primary keys", () => {
    const tenancyId = "11111111-1111-4111-8111-111111111111";
    const first = emailOutboxIdForIdempotencyKey(tenancyId, "workflow-run:send-email", 0);
    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u);
    expect(emailOutboxIdForIdempotencyKey(tenancyId, "workflow-run:send-email", 0)).toBe(first);
    expect(emailOutboxIdForIdempotencyKey(tenancyId, "workflow-run:send-email", 1)).not.toBe(first);
    expect(emailOutboxIdForIdempotencyKey(tenancyId, "another-run:send-email", 0)).not.toBe(first);
  });
});
