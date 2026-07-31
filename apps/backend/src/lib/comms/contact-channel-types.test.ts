import { describe, expect, it } from "vitest";
import {
  formatDisplayValue,
  normalizeContactChannelWrite,
} from "./contact-channel-types";

describe("normalizeContactChannelWrite", () => {
  it("normalizes email to lowercase canonical value", () => {
    const normalized = normalizeContactChannelWrite({
      type: "email",
      value: "Alice@Example.COM",
    });
    expect(normalized).toMatchObject({
      type: "email",
      prismaType: "EMAIL",
      value: "alice@example.com",
      identityScope: "",
    });
  });

  it("requires slack workspace_id and scopes identity by it", () => {
    const normalized = normalizeContactChannelWrite({
      type: "slack",
      value: "U123",
      workspace_id: "T456",
    });
    expect(normalized).toMatchObject({
      type: "slack",
      prismaType: "SLACK",
      value: "U123",
      identityScope: "T456",
    });
  });

  it("scopes push identity by provider/app/environment", () => {
    const normalized = normalizeContactChannelWrite({
      type: "push",
      value: "token-abc",
      provider: "apns",
      app_id: "com.example.app",
      environment: "production",
    });
    expect(normalized.identityScope).toBe("apns:com.example.app:production");
    expect(normalized.prismaType).toBe("PUSH");
  });

  it("rejects unsupported write shapes", () => {
    expect(() => normalizeContactChannelWrite({
      type: "slack",
      value: "U123",
      // missing workspace_id
    } as never)).toThrow();
  });
});

describe("formatDisplayValue", () => {
  it("returns email value as display value", () => {
    expect(formatDisplayValue("email", "alice@example.com", null)).toBe("alice@example.com");
  });

  it("appends phone extension when present", () => {
    expect(formatDisplayValue("phone", "+15551212", { extension: "99" })).toBe("+155 51212 ext. 99");
  });
});
