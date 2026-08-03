import { describe, expect, it } from "vitest";
import { sanitizeBrainPayload } from "./sanitize";

describe("sanitizeBrainPayload", () => {
  it("redacts sensitive keys while keeping analytical fields", () => {
    expect(sanitizeBrainPayload({
      user_id: "u1",
      password: "hunter2",
      refresh_token: "abc",
      nested: { api_key: "k", ok: true },
    })).toEqual({
      user_id: "u1",
      password: "[redacted]",
      refresh_token: "[redacted]",
      nested: { api_key: "[redacted]", ok: true },
    });
  });

  it("truncates very long strings", () => {
    const long = "x".repeat(5000);
    const result = sanitizeBrainPayload({ note: long }) as { note: string };
    expect(result.note.startsWith("x".repeat(4000))).toBe(true);
    expect(result.note).toContain("[truncated");
  });
});
