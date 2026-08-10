import { describe, expect, it } from "vitest";
import { buildIssueEventGraphNodes } from "./issue-event-graph";

const issue = { short_id: "42", release: "web@2026.08.06" };

describe("buildIssueEventGraphNodes", () => {
  it("keeps every retained cross-signal link occurrence-scoped", () => {
    const nodes = buildIssueEventGraphNodes("project/one", issue, {
      occurrence_id: "occurrence-1234567890",
      trace_id: "trace-1234567890",
      session_replay_id: "replay/one",
      user_id: "user/one",
    }, 3);

    expect(nodes.map((node) => node.id)).toEqual(["issue", "occurrence", "trace", "logs", "replay", "user", "release"]);
    expect(nodes.find((node) => node.id === "trace")?.href).toContain("trace=trace-1234567890");
    expect(nodes.find((node) => node.id === "replay")?.href).toContain("replay%2Fone");
    expect(nodes.find((node) => node.id === "logs")?.available).toBe(true);
  });

  it("renders missing context as explicit unavailable nodes", () => {
    const nodes = buildIssueEventGraphNodes("project-1", { short_id: "7", release: null }, null, 0);

    expect(nodes.filter((node) => !node.available).map((node) => node.id)).toEqual([
      "occurrence", "trace", "logs", "replay", "user", "release",
    ]);
    expect(nodes.every((node) => node.href == null || node.available)).toBe(true);
  });
});
