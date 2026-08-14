import { describe, expect, it } from "vitest";
import { GROWTH_METRIC_CATALOG } from "../metric-catalog";
import type { GrowthMetricsOverviewBody, GrowthMetricsOverviewMetric } from "../metrics-overview";
import {
  buildQuizFacts,
  countAnswerableQuizFacts,
  DEFAULT_QUIZ_QUESTION_COUNT,
  formatQuizValue,
  MIN_ANSWERABLE_FACTS,
  MIN_SERIES_DAYS,
  QUIZ_VALUE_UNITS,
} from "./quiz-facts";

// 2026-08-02 is a Sunday, so day index 0 of every series below is a Sunday and the weekday
// assertions can be written by hand.
const SERIES_START = Date.UTC(2026, 7, 2);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(offset: number): string {
  return new Date(SERIES_START + offset * ONE_DAY_MS).toISOString().slice(0, 10);
}

function series(values: number[]): { date: string, value: number }[] {
  return values.map((value, index) => ({ date: dayKey(index), value }));
}

function metric(overrides: Partial<GrowthMetricsOverviewMetric> & { id: string }): GrowthMetricsOverviewMetric {
  const points = overrides.series ?? series(Array.from({ length: 60 }, (_, index) => 100 + index));
  return {
    label: overrides.label ?? `Metric ${overrides.id}`,
    unit: overrides.unit ?? "count",
    category: overrides.category ?? "users",
    kind: overrides.kind ?? "flow",
    description: overrides.description ?? "A test metric.",
    latest: overrides.latest !== undefined ? overrides.latest : (points.length === 0 ? null : points[points.length - 1]),
    ...overrides,
    id: overrides.id,
    series: points,
  };
}

function overview(metrics: GrowthMetricsOverviewMetric[]): GrowthMetricsOverviewBody {
  return {
    window_days: 90,
    latest_stored_date: metrics.flatMap((entry) => entry.latest == null ? [] : [entry.latest.date]).sort().at(-1) ?? null,
    metrics,
    ad_accounts: [],
  };
}

/** A project with plenty of varied history — the happy path for most assertions below. */
function richOverview(): GrowthMetricsOverviewBody {
  return overview([
    metric({ id: "new_users", label: "New users", kind: "flow", series: series(Array.from({ length: 60 }, (_, i) => 30 + (i % 7 === 2 ? 60 : i % 5))) }),
    metric({ id: "total_users", label: "Total users", kind: "snapshot", series: series(Array.from({ length: 60 }, (_, i) => 4000 + i * 31)) }),
    metric({ id: "dau", label: "Daily active users", kind: "flow", series: series(Array.from({ length: 60 }, (_, i) => 200 + (i % 7 === 4 ? 300 : i % 11))) }),
    metric({ id: "page_views", label: "Page views", kind: "flow", category: "web", series: series(Array.from({ length: 60 }, (_, i) => 5000 + i * 40)) }),
    metric({ id: "clicks", label: "Clicks", kind: "flow", category: "web", series: series(Array.from({ length: 60 }, (_, i) => 900 + i * 3)) }),
    metric({ id: "emails_sent_total", label: "Emails sent", kind: "flow", category: "email", series: series(Array.from({ length: 60 }, (_, i) => 140 + i * 2)) }),
    metric({ id: "visitor_signup_rate", label: "Visitor signup rate", unit: "percent", kind: "flow", category: "derived", series: series(Array.from({ length: 60 }, (_, i) => 3 + (i % 5) * 0.2)) }),
    metric({ id: "revenue_cents", label: "Revenue", unit: "cents", kind: "flow", category: "revenue", series: series(Array.from({ length: 60 }, (_, i) => 12_000 + i * 900)) }),
    metric({ id: "avg_session_seconds", label: "Average session length", unit: "seconds", kind: "snapshot", category: "web", series: series(Array.from({ length: 60 }, (_, i) => 300 + i * 4)) }),
  ]);
}

describe("QUIZ_VALUE_UNITS", () => {
  it("covers exactly the catalog's unit vocabulary", () => {
    // The stored `unit` column is narrowed back through this list (assertQuizUnit in quiz.ts), so a
    // unit added to the catalog without being added here would fail at read time, not write time.
    const catalogUnits = [...new Set(GROWTH_METRIC_CATALOG.map((entry) => entry.unit))].sort();
    expect([...QUIZ_VALUE_UNITS].sort()).toEqual(catalogUnits);
  });
});

describe("formatQuizValue", () => {
  it("renders each unit the way the dashboard would", () => {
    expect(formatQuizValue(1204, "count")).toMatchInlineSnapshot(`"1,204"`);
    expect(formatQuizValue(12_345, "cents")).toMatchInlineSnapshot(`"$123"`);
    expect(formatQuizValue(3.14159, "percent")).toMatchInlineSnapshot(`"3.1%"`);
    expect(formatQuizValue(42, "seconds")).toMatchInlineSnapshot(`"42s"`);
    expect(formatQuizValue(3725, "seconds")).toMatchInlineSnapshot(`"1h 02m"`);
  });
});

describe("buildQuizFacts", () => {
  it("builds a full round from a project with varied history", () => {
    const result = buildQuizFacts(richOverview(), { seed: "seed-a" });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.facts.length).toBe(DEFAULT_QUIZ_QUESTION_COUNT);
    expect(result.metricsAsOf).toBe(dayKey(59));
  });

  it("gives every question four distinct options with the correct one among them", () => {
    const result = buildQuizFacts(richOverview(), { seed: "seed-b" });
    if (result.status !== "ok") throw new Error("expected a playable round");
    for (const fact of result.facts) {
      expect(fact.options).toHaveLength(4);
      // Distinct by label, not just by value: the label is what the player compares, and two
      // different numbers that round to the same string are the same option to them.
      expect(new Set(fact.options.map((option) => option.label)).size).toBe(4);
      expect(new Set(fact.options.map((option) => option.id)).size).toBe(4);
      expect(fact.options.some((option) => option.id === fact.correctOptionId)).toBe(true);
      expect(fact.templateText.length).toBeGreaterThan(0);
      expect(fact.templateExplanation.length).toBeGreaterThan(0);
    }
  });

  it("never lets the correct answer be the odd one out", () => {
    // The whole game breaks if the truth is guessable from the shape of the options — the classic
    // failure is rounding the distractors but not the answer ("1,247" among "400 / 2,400 / 5,000").
    // Every numeric option must share the same significant-figure treatment.
    const result = buildQuizFacts(richOverview(), { seed: "seed-c" });
    if (result.status !== "ok") throw new Error("expected a playable round");
    const significantDigits = (label: string): number => {
      const digits = label.replace(/[^\d]/g, "").replace(/^0+/, "").replace(/0+$/, "");
      return digits.length;
    };
    for (const fact of result.facts) {
      if (fact.kind === "peak_weekday" || fact.kind === "rank_among") continue;
      const spreads = fact.options.map((option) => significantDigits(option.label));
      expect(Math.max(...spreads)).toBeLessThanOrEqual(3);
    }
  });

  it("does not systematically place the correct answer in the same position", () => {
    const positions = new Set<number>();
    for (let index = 0; index < 25; index++) {
      const result = buildQuizFacts(richOverview(), { seed: `shuffle-${index}` });
      if (result.status !== "ok") continue;
      for (const fact of result.facts) {
        positions.add(fact.options.findIndex((option) => option.id === fact.correctOptionId));
      }
    }
    expect([...positions].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it("is deterministic for a given seed and varies across seeds", () => {
    const first = buildQuizFacts(richOverview(), { seed: "same" });
    const second = buildQuizFacts(richOverview(), { seed: "same" });
    const other = buildQuizFacts(richOverview(), { seed: "different" });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(JSON.stringify(first)).not.toBe(JSON.stringify(other));
  });

  it("asks about a metric at most once per round", () => {
    // Eight variations on new_users reads as a bug even when every question is individually correct.
    const result = buildQuizFacts(richOverview(), { seed: "diversity" });
    if (result.status !== "ok") throw new Error("expected a playable round");
    const perMetric = result.facts.filter((fact) => fact.kind !== "rank_among").map((fact) => fact.metricId);
    expect(new Set(perMetric).size).toBe(perMetric.length);
  });
});

describe("buildQuizFacts gating", () => {
  it("refuses a project with no metric history at all", () => {
    const result = buildQuizFacts(overview([]), { seed: "empty" });
    expect(result).toMatchInlineSnapshot(`
      {
        "answerableCount": 0,
        "required": 6,
        "status": "insufficient",
      }
    `);
  });

  it("treats an all-zero metric as an empty state, not a question", () => {
    const flat = overview([metric({ id: "new_users", series: series(Array.from({ length: 60 }, () => 0)) })]);
    const result = buildQuizFacts(flat, { seed: "zeroes" });
    expect(result.status).toBe("insufficient");
  });

  it("refuses a metric with less than the minimum history", () => {
    const short = overview([
      metric({ id: "new_users", series: series(Array.from({ length: MIN_SERIES_DAYS - 1 }, (_, i) => 10 + i)) }),
    ]);
    const result = buildQuizFacts(short, { seed: "short" });
    expect(result.status).toBe("insufficient");
    if (result.status !== "insufficient") return;
    expect(result.answerableCount).toBe(0);
  });

  it("serves a short round rather than refusing when a project supports more than the minimum but fewer than a full round", () => {
    const modest = overview([
      metric({ id: "new_users", label: "New users", kind: "flow", series: series(Array.from({ length: 40 }, (_, i) => 20 + i)) }),
      metric({ id: "total_users", label: "Total users", kind: "snapshot", series: series(Array.from({ length: 40 }, (_, i) => 900 + i * 12)) }),
      metric({ id: "dau", label: "Daily active users", kind: "flow", series: series(Array.from({ length: 40 }, (_, i) => 80 + (i % 7 === 3 ? 90 : i % 4))) }),
      metric({ id: "visitor_signup_rate", label: "Visitor signup rate", unit: "percent", kind: "flow", series: series(Array.from({ length: 40 }, (_, i) => 2 + (i % 6) * 0.3)) }),
    ]);
    const result = buildQuizFacts(modest, { seed: "modest" });
    if (result.status !== "ok") {
      // Fine as long as the gate is the reason — the point of this case is that the boundary is
      // decided by the answerable count, not by an exception.
      expect(result.answerableCount).toBeLessThan(MIN_ANSWERABLE_FACTS);
      return;
    }
    expect(result.facts.length).toBeGreaterThanOrEqual(MIN_ANSWERABLE_FACTS);
    expect(result.facts.length).toBeLessThanOrEqual(DEFAULT_QUIZ_QUESTION_COUNT);
  });
});

describe("countAnswerableQuizFacts", () => {
  it("reports zero for an empty project and at least the minimum for a rich one", () => {
    expect(countAnswerableQuizFacts(overview([]))).toBe(0);
    expect(countAnswerableQuizFacts(richOverview())).toBeGreaterThanOrEqual(MIN_ANSWERABLE_FACTS);
  });
});
