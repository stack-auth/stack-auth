import type { AdminEmailOutboxStatus } from "@hexclave/next";
import { describe, expect, it } from "vitest";
import { countEmailsSince, getDeliverySuccessRate, groupEmailsBySource, isEmailApiEmail } from "./email-api-logic";

const email = (overrides: {
  createdWith: "draft" | "programmatic-call",
  emailProgrammaticCallTemplateId: string | null,
  createdAt?: Date,
  status?: AdminEmailOutboxStatus,
  simpleStatus?: "in-progress" | "ok" | "error",
}) => ({
  createdWith: overrides.createdWith,
  emailProgrammaticCallTemplateId: overrides.emailProgrammaticCallTemplateId,
  createdAt: overrides.createdAt ?? new Date("2025-01-01T00:00:00Z"),
  status: overrides.status ?? "sent" as const,
  simpleStatus: overrides.simpleStatus ?? "ok" as const,
});

describe("Email API analytics", () => {
  it("only includes programmatic-call rows", () => {
    expect(isEmailApiEmail(email({ createdWith: "programmatic-call", emailProgrammaticCallTemplateId: null }))).toBe(true);
    expect(isEmailApiEmail(email({ createdWith: "programmatic-call", emailProgrammaticCallTemplateId: "tpl" }))).toBe(true);
    expect(isEmailApiEmail(email({ createdWith: "draft", emailProgrammaticCallTemplateId: null }))).toBe(false);
  });

  it("counts rows on the window boundaries", () => {
    const now = new Date("2025-01-02T00:00:00Z");
    const rows = [
      email({ createdWith: "programmatic-call", emailProgrammaticCallTemplateId: null, createdAt: new Date("2025-01-01T00:00:00Z") }),
      email({ createdWith: "programmatic-call", emailProgrammaticCallTemplateId: null, createdAt: new Date("2025-01-01T00:00:01Z") }),
      email({ createdWith: "programmatic-call", emailProgrammaticCallTemplateId: null, createdAt: now }),
    ];
    expect(countEmailsSince(rows, now, 24 * 60 * 60 * 1000)).toBe(3);
  });

  it("groups template sends and raw HTML separately", () => {
    const rows = [
      email({ createdWith: "programmatic-call", emailProgrammaticCallTemplateId: "tpl-1", status: "sent" }),
      email({ createdWith: "programmatic-call", emailProgrammaticCallTemplateId: "tpl-1", status: "bounced" }),
      email({ createdWith: "programmatic-call", emailProgrammaticCallTemplateId: null, status: "queued" }),
    ];
    const groups = groupEmailsBySource(rows, new Map([["tpl-1", "Welcome"]]));
    expect(groups.map((group) => [group.displayName, group.count])).toEqual([["Welcome", 2], ["Raw HTML", 1]]);
    expect(groups[0].statuses).toEqual({ sent: 1, bounced: 1 });
  });

  it("returns zero for empty delivery data", () => {
    expect(getDeliverySuccessRate([])).toBe(0);
    expect(getDeliverySuccessRate([email({ createdWith: "programmatic-call", emailProgrammaticCallTemplateId: null, status: "sent" }), email({ createdWith: "programmatic-call", emailProgrammaticCallTemplateId: null, status: "bounced" })])).toBe(0.5);
  });
});
