import { describe, expect, it } from "vitest";
import {
  GROWTH_AGENT_ERROR_MESSAGE_MAX_CHARS,
  isValidGrowthFindingSource,
  parseGrowthBriefDate,
  resolveGrowthCategoryScores,
  resolveGrowthWatchedMetrics,
  truncateGrowthAgentErrorMessage,
} from "./agent-writes";
import { GROWTH_CATEGORIES } from "./categories";

function completeScores(score: number) {
  return GROWTH_CATEGORIES.map((category) => ({ category, score }));
}

describe("truncateGrowthAgentErrorMessage", () => {
  it("passes short messages through unchanged", () => {
    expect(truncateGrowthAgentErrorMessage("boom")).toBe("boom");
    expect(truncateGrowthAgentErrorMessage("")).toBe("");
  });

  it("truncates to the dashboard-visible limit", () => {
    const long = "x".repeat(GROWTH_AGENT_ERROR_MESSAGE_MAX_CHARS + 100);
    expect(truncateGrowthAgentErrorMessage(long)).toHaveLength(GROWTH_AGENT_ERROR_MESSAGE_MAX_CHARS);
    expect(truncateGrowthAgentErrorMessage("y".repeat(GROWTH_AGENT_ERROR_MESSAGE_MAX_CHARS))).toHaveLength(GROWTH_AGENT_ERROR_MESSAGE_MAX_CHARS);
  });
});

describe("isValidGrowthFindingSource", () => {
  it("accepts every phase key of a run", () => {
    for (const source of ["website-research", "data-analysis", "interview-questions", "report", "analysis:seo-aeo-strategy"]) {
      expect(isValidGrowthFindingSource(source)).toBe(true);
    }
  });

  it("accepts the fixed non-phase sources", () => {
    for (const source of ["daily-brief", "scheduled-task", "chat"]) {
      expect(isValidGrowthFindingSource(source)).toBe(true);
    }
  });

  it("rejects unknown sources and unknown analysis topics", () => {
    expect(isValidGrowthFindingSource("nonsense")).toBe(false);
    expect(isValidGrowthFindingSource("analysis:does-not-exist")).toBe(false);
    expect(isValidGrowthFindingSource("")).toBe(false);
  });

  it("rejects SUBAGENT names that are not phase keys", () => {
    // Regression guard. The growth agent's subagents are named after their job, not their phase,
    // and `data-analyst` writes findings for the `data-analysis` phase. Its tool hardcoded the
    // subagent's own name, so every finding it produced was rejected with a 400 while the phase
    // still reported COMPLETED — silent data loss rather than a visible failure. `website-research`
    // hides the trap by being both a subagent name and a phase key.
    expect(isValidGrowthFindingSource("data-analyst")).toBe(false);
    expect(isValidGrowthFindingSource("data-analysis")).toBe(true);
    expect(isValidGrowthFindingSource("report-composer")).toBe(false);
    expect(isValidGrowthFindingSource("report")).toBe(true);
  });
});

describe("resolveGrowthCategoryScores", () => {
  it("accepts a complete growth journey in any order and keys it by stage", () => {
    const resolved = resolveGrowthCategoryScores([...completeScores(40)].reverse());
    expect(resolved.size).toBe(GROWTH_CATEGORIES.length);
    for (const category of GROWTH_CATEGORIES) expect(resolved.get(category)).toBe(40);
  });

  it("rejects a partial journey and names what is missing", () => {
    // The whole point of the completeness rule: a partial write would leave some stages on
    // "Not scored" while the
    // agent believed it had scored the project.
    const partial = completeScores(50).filter((entry) => entry.category !== "retention" && entry.category !== "revenue");
    expect(() => resolveGrowthCategoryScores(partial)).toThrow(/Scores are missing for: retention, revenue/);
    expect(() => resolveGrowthCategoryScores([])).toThrow(/Score all 5 categories in a single call/);
  });

  it("rejects a category scored twice rather than letting the last write win", () => {
    expect(() => resolveGrowthCategoryScores([...completeScores(50), { category: "revenue", score: 90 }]))
      .toThrow(/"revenue" was scored more than once/);
  });

  it("rejects out-of-range and non-integer scores", () => {
    for (const bad of [-1, 101, 33.3]) {
      const scores = completeScores(50).map((entry) => entry.category === "retention" ? { ...entry, score: bad } : entry);
      expect(() => resolveGrowthCategoryScores(scores)).toThrow(/score must be an integer from 0 to 100/);
    }
  });

  it("rejects an unknown category before considering completeness", () => {
    expect(() => resolveGrowthCategoryScores([...completeScores(50), { category: "virality", score: 10 }]))
      .toThrow(/Unknown growth category: virality/);
  });

  it("accepts the range boundaries", () => {
    expect(resolveGrowthCategoryScores(completeScores(0)).get("product")).toBe(0);
    expect(resolveGrowthCategoryScores(completeScores(100)).get("product")).toBe(100);
  });
});

describe("parseGrowthBriefDate", () => {
  it("parses valid dates to UTC midnight", () => {
    const parsed = parseGrowthBriefDate("2026-08-04");
    expect(parsed.toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });

  it("rejects malformed strings", () => {
    for (const value of ["2026-8-4", "20260804", "2026-08-04T00:00:00Z", "yesterday", ""]) {
      expect(() => parseGrowthBriefDate(value)).toThrow(/YYYY-MM-DD/);
    }
  });

  it("rejects calendar-invalid dates instead of rolling them over", () => {
    // new Date("2026-02-30") would silently become March 2nd — the round-trip check catches that.
    expect(() => parseGrowthBriefDate("2026-02-30")).toThrow(/not a valid calendar date/);
    expect(() => parseGrowthBriefDate("2026-13-01")).toThrow(/not a valid calendar date/);
    expect(() => parseGrowthBriefDate("2026-00-10")).toThrow(/not a valid calendar date/);
  });

  it("accepts leap days only in leap years", () => {
    expect(parseGrowthBriefDate("2028-02-29").toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(() => parseGrowthBriefDate("2026-02-29")).toThrow(/not a valid calendar date/);
  });
});

describe("resolveGrowthWatchedMetrics", () => {
  it("falls back to the type registry defaults when the agent sends nothing", () => {
    expect(resolveGrowthWatchedMetrics("run_ads", undefined)).toEqual([
      { metricId: "new_signups", windowDays: 14 },
      { metricId: "total_users", windowDays: 14 },
    ]);
  });

  it("converts valid agent-provided metrics from wire shape", () => {
    expect(resolveGrowthWatchedMetrics("custom", [{ metric_id: "revenue", window_days: 30 }])).toEqual([
      { metricId: "revenue", windowDays: 30 },
    ]);
  });

  it("rejects unknown metric ids and out-of-range windows", () => {
    expect(() => resolveGrowthWatchedMetrics("custom", [{ metric_id: "nonsense", window_days: 14 }])).toThrow(/Unknown watched metric id/);
    expect(() => resolveGrowthWatchedMetrics("custom", [{ metric_id: "revenue", window_days: 0 }])).toThrow(/window_days/);
    expect(() => resolveGrowthWatchedMetrics("custom", [{ metric_id: "revenue", window_days: 1.5 }])).toThrow(/window_days/);
    expect(() => resolveGrowthWatchedMetrics("custom", [{ metric_id: "revenue", window_days: 400 }])).toThrow(/window_days/);
  });

  it("rejects unknown type ids before looking at the metrics", () => {
    expect(() => resolveGrowthWatchedMetrics("nonsense", undefined)).toThrow(/Unknown growth action item type/);
  });
});
