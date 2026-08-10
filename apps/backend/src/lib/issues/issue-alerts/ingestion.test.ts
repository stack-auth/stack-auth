import { describe, expect, it } from "vitest";
import { collectIssueAlertFrequencyWindows } from "./ingestion";
import type { IssueAlertRule } from "./types";

function rule(id: string, predicates: IssueAlertRule["conditions"]["all"]): IssueAlertRule {
  return {
    schemaVersion: 1,
    id,
    version: 1,
    enabled: true,
    conditions: { all: predicates },
    cooldown: { durationSeconds: 60, keyBy: "issue" },
    action: { type: "email", userIds: ["user"], subject: "Alert", html: "<p>Alert</p>" },
  };
}

describe("collectIssueAlertFrequencyWindows", () => {
  it("deduplicates windows across conjunctive and disjunctive rule groups", () => {
    expect(collectIssueAlertFrequencyWindows([
      rule("one", [{ type: "frequency", operator: "gte", count: 2, windowSeconds: 60 }]),
      {
        ...rule("two", [{ type: "frequency", operator: "gt", count: 4, windowSeconds: 3_600 }]),
        conditions: {
          all: [{ type: "frequency", operator: "gt", count: 4, windowSeconds: 3_600 }],
          any: [{ type: "frequency", operator: "eq", count: 1, windowSeconds: 60 }],
        },
      },
    ])).toEqual([60, 3_600]);
  });

  it("returns an empty set when no rule uses frequency", () => {
    expect(collectIssueAlertFrequencyWindows([rule("plain", [{ type: "new", value: true }])])).toEqual([]);
  });
});
