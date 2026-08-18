import type { GrowthCatalogMetric } from "../metric-catalog";
import type { GrowthMetricsOverviewBody, GrowthMetricsOverviewMetric, GrowthMetricsOverviewPoint } from "../metrics-overview";

/**
 * PURE: the growth metric catalog + a 90-day metrics-overview body → a set of multiple-choice
 * questions about the project's own numbers, for the "How well do you know your users?" game.
 *
 * WHY THIS IS PURE AND WHY IT OWNS THE ANSWERS: the question *prose* is written by the growth agent
 * (see quiz-agent.ts), but no number the game asserts may ever come from a model. Everything the
 * game scores — the true value, all three distractors, and which option is correct — is computed
 * here from real rolled-up rows. An LLM that miscounted would be telling a customer something false
 * about their own product on the one surface whose entire premise is that the data is trustworthy.
 *
 * The other load-bearing property is that the correct option must not be *inferable from its shape*.
 * Two things protect that:
 *   1. Every option, including the true one, goes through the same rounding. A quiz where the truth
 *      is the only un-round number ("1,247" among "400 / 2,400 / 5,000") is trivially winnable
 *      without knowing anything. `trueValue` keeps the exact figure for the post-answer reveal.
 *   2. Options are shuffled with the round's seeded RNG and their ids are assigned by position
 *      afterwards, so neither the order nor the id carries signal.
 */

/**
 * The unit vocabulary a quiz value can carry — the catalog's own set, re-declared here as a runtime
 * array because the stored `unit` column comes back as a plain string and has to be narrowed back
 * into it (see assertQuizUnit in quiz.ts). quiz-facts.test.ts pins it against the catalog.
 */
export const QUIZ_VALUE_UNITS = ["count", "cents", "percent", "seconds", "minor_units"] as const;
export type QuizValueUnit = typeof QUIZ_VALUE_UNITS[number];

export const QUIZ_FACT_KINDS = [
  "latest_value",
  "window_sum",
  "window_change_pct",
  "peak_weekday",
  "rank_among",
  "ratio",
] as const;
export type QuizFactKind = typeof QUIZ_FACT_KINDS[number];

export type QuizFactOption = {
  id: string,
  label: string,
};

export type QuizFact = {
  /** Stable within a round. The agent echoes it back so authored prose can be matched to its fact. */
  factId: string,
  metricId: string,
  metricLabel: string,
  /** Straight from the catalog — the agent's only semantics documentation for this metric. */
  metricDescription: string,
  kind: QuizFactKind,
  unit: GrowthCatalogMetric["unit"],
  /** The exact figure, un-rounded. Shown only after the question has been answered. */
  trueValue: number,
  options: QuizFactOption[],
  correctOptionId: string,
  /** Deterministic fallback wording, used verbatim when the agent turn fails. */
  templateText: string,
  templateExplanation: string,
};

export type BuildQuizFactsResult =
  | { status: "ok", facts: QuizFact[], metricsAsOf: string | null }
  | { status: "insufficient", answerableCount: number, required: number };

/** Days of history a metric needs before any question may be asked about it. */
export const MIN_SERIES_DAYS = 14;
/** Distinct answerable facts a round needs. Below this the section shows its not-enough-data gate. */
export const MIN_ANSWERABLE_FACTS = 6;
/** Questions in a full round. Fewer are served only if that is all the project's data supports. */
export const DEFAULT_QUIZ_QUESTION_COUNT = 8;

const OPTIONS_PER_QUESTION = 4;
const SHORT_WINDOW_DAYS = 14;
const SUM_WINDOW_DAYS = 30;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// ─── Deterministic RNG ───────────────────────────────────────────────────────
// Seeded rather than Math.random() so a round is reproducible from its seed: the same seed must
// produce the same questions, distractors, and shuffle, which is what makes this file testable at
// all (and what lets a failed generation be retried without silently changing the quiz).

function hashSeed(seed: string): number {
  // FNV-1a. Chosen for being four lines long, not for cryptographic quality — nothing here is a
  // secret, the shuffle only needs to be unbiased and reproducible.
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index++) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

type Rng = () => number;

function createRng(seed: string): Rng {
  let state = hashSeed(seed) || 1;
  return () => {
    // mulberry32.
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapWith = Math.floor(rng() * (index + 1));
    [result[index], result[swapWith]] = [result[swapWith], result[index]];
  }
  return result;
}

// ─── Value formatting ────────────────────────────────────────────────────────
// Option labels are rendered here, at write time, and stored on the row. The dashboard renders the
// stored strings verbatim: the server is the only place that knows which rounding was applied, and
// re-deriving a label on the client from `trueValue` would leak the answer into the page.

function formatSecondsDuration(totalSeconds: number): string {
  const seconds = Math.round(totalSeconds);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(seconds / 3600)}h ${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}m`;
}

/**
 * Formats one already-rounded quiz value for display. Mirrors the dashboard's
 * formatGrowthMetricValue for the units the quiz can ask about; `minor_units` is unreachable because
 * only the ads catalog entries use it and those are excluded from the candidate pool (their dates
 * are ad-account-local, so a "yesterday" question about them would be quietly wrong).
 */
export function formatQuizValue(value: number, unit: GrowthCatalogMetric["unit"]): string {
  switch (unit) {
    case "count": {
      return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
    }
    case "cents": {
      return `$${(value / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
    }
    case "percent": {
      return `${value.toFixed(1)}%`;
    }
    case "seconds": {
      return formatSecondsDuration(value);
    }
    case "minor_units": {
      return `${value.toLocaleString("en-US")} (minor units)`;
    }
  }
}

function formatSignedPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/**
 * Rounds to `significantDigits` significant figures. Applied identically to the truth and to every
 * distractor so the correct answer is not the odd one out (see the file header).
 */
function roundToSignificant(value: number, significantDigits: number): number {
  if (value === 0) return 0;
  const magnitude = Math.floor(Math.log10(Math.abs(value)));
  const factor = Math.pow(10, significantDigits - 1 - magnitude);
  return Math.round(value * factor) / factor;
}

// ─── Distractor generation ───────────────────────────────────────────────────

/**
 * Spread factors for magnitude questions: one clearly low, one modestly high, one wildly high. Wide
 * enough that a person who knows their numbers wins, narrow enough that a guess is a real guess.
 */
const MAGNITUDE_FACTORS = [0.35, 1.9, 4.2];
const MAGNITUDE_FALLBACK_FACTORS = [0.15, 3.1, 8];

/**
 * Builds four distinct numeric options around `trueValue`, or null when the value is too small or
 * too coarse for four of them to be distinguishable after rounding (e.g. a metric sitting at 2 —
 * "1 / 2 / 4 / 8" is a fine quiz, "0 / 0 / 2 / 8" is not). A fact that cannot produce four options
 * is dropped from the pool rather than served with duplicates.
 */
function buildMagnitudeOptionValues(trueValue: number, unit: GrowthCatalogMetric["unit"]): number[] | null {
  const significantDigits = unit === "percent" ? 3 : 2;
  const wholeNumbers = unit === "count" || unit === "cents";
  const normalize = (raw: number): number => {
    const clamped = unit === "percent" ? Math.min(Math.max(raw, 0), 100) : Math.max(raw, 0);
    const rounded = roundToSignificant(clamped, significantDigits);
    return wholeNumbers ? Math.round(rounded) : rounded;
  };

  for (const factors of [MAGNITUDE_FACTORS, MAGNITUDE_FALLBACK_FACTORS]) {
    const values = [normalize(trueValue), ...factors.map((factor) => normalize(trueValue * factor))];
    if (new Set(values).size === OPTIONS_PER_QUESTION) return values;
  }
  return null;
}

/**
 * Percentage-change options. Sign matters more than magnitude here — "did it go up or down" is the
 * interesting half of the question — so one distractor is always the mirror of the true direction.
 */
function buildChangeOptionValues(trueChangePercent: number): number[] | null {
  const magnitude = Math.abs(trueChangePercent);
  const sign = Math.sign(trueChangePercent);
  const candidates = [
    Math.round(trueChangePercent),
    Math.round(-sign * magnitude * 0.8),
    Math.round(sign * magnitude * 2.4),
    Math.round(sign * magnitude * 0.3),
  ];
  return new Set(candidates).size === OPTIONS_PER_QUESTION ? candidates : null;
}

function toOptions(labels: readonly string[], correctIndex: number, rng: Rng): { options: QuizFactOption[], correctOptionId: string } {
  const order = shuffled(labels.map((label, index) => ({ label, isCorrect: index === correctIndex })), rng);
  // Ids are assigned by position AFTER the shuffle, so neither the id nor the order says anything
  // about which option is the answer.
  const options = order.map((entry, index) => ({ id: `o${index}`, label: entry.label }));
  const correctPosition = order.findIndex((entry) => entry.isCorrect);
  return { options, correctOptionId: options[correctPosition].id };
}

// ─── Series helpers ──────────────────────────────────────────────────────────

function lastNPoints(series: readonly GrowthMetricsOverviewPoint[], days: number): GrowthMetricsOverviewPoint[] {
  return series.slice(Math.max(0, series.length - days));
}

function sumValues(points: readonly GrowthMetricsOverviewPoint[]): number {
  return points.reduce((total, point) => total + point.value, 0);
}

function meanValues(points: readonly GrowthMetricsOverviewPoint[]): number {
  return points.length === 0 ? 0 : sumValues(points) / points.length;
}

/** ISO day key (YYYY-MM-DD) → weekday index, without going through a locale-dependent parse. */
function weekdayIndexOf(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (match == null) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).getUTCDay();
}

/** A metric with no history, or one that is flat zero across the whole window, is an empty state — not a question. */
function hasUsableHistory(metric: GrowthMetricsOverviewMetric): boolean {
  return metric.series.length >= MIN_SERIES_DAYS && metric.series.some((point) => point.value > 0);
}

// ─── Per-kind fact builders ──────────────────────────────────────────────────
// Each returns null when this metric cannot support this question kind. Returning null is the
// normal case, not an error: most metrics only support one or two of the six shapes.

type FactBuilderContext = {
  metric: GrowthMetricsOverviewMetric,
  rng: Rng,
};

function buildNumericFact(
  context: FactBuilderContext,
  spec: { kind: QuizFactKind, trueValue: number, text: string, explanation: string },
): QuizFact | null {
  const { metric, rng } = context;
  const optionValues = buildMagnitudeOptionValues(spec.trueValue, metric.unit);
  if (optionValues == null) return null;
  const labels = optionValues.map((value) => formatQuizValue(value, metric.unit));
  // Rounding can collapse two different numbers onto the same label even when the numbers differ
  // (e.g. two `seconds` values inside the same minute). Labels are what the player sees, so
  // uniqueness has to hold at the label level too.
  if (new Set(labels).size !== labels.length) return null;
  const { options, correctOptionId } = toOptions(labels, 0, rng);
  return {
    factId: `${metric.id}:${spec.kind}`,
    metricId: metric.id,
    metricLabel: metric.label,
    metricDescription: metric.description,
    kind: spec.kind,
    unit: metric.unit,
    trueValue: spec.trueValue,
    options,
    correctOptionId,
    templateText: spec.text,
    templateExplanation: spec.explanation,
  };
}

function buildLatestValueFact(context: FactBuilderContext): QuizFact | null {
  const { metric } = context;
  // Snapshots only: "how many do you have right now" is a meaningful question about a running total
  // and a meaningless one about a per-day flow (where the honest answer is "on which day?").
  if (metric.kind !== "snapshot" || metric.latest == null || metric.latest.value <= 0) return null;
  return buildNumericFact(context, {
    kind: "latest_value",
    trueValue: metric.latest.value,
    text: `How many ${metric.label.toLowerCase()} does your project have right now?`,
    explanation: `${metric.label}: ${metric.description}`,
  });
}

function buildWindowSumFact(context: FactBuilderContext): QuizFact | null {
  const { metric } = context;
  if (metric.kind !== "flow") return null;
  const window = lastNPoints(metric.series, SUM_WINDOW_DAYS);
  if (window.length < MIN_SERIES_DAYS) return null;
  const total = sumValues(window);
  if (total <= 0) return null;
  return buildNumericFact(context, {
    kind: "window_sum",
    trueValue: total,
    text: `Across the last ${window.length} days, what did your ${metric.label.toLowerCase()} add up to?`,
    explanation: `${metric.label}: ${metric.description}`,
  });
}

function buildRatioFact(context: FactBuilderContext): QuizFact | null {
  const { metric } = context;
  // Rates are noisy day to day, so the question is about the 30-day average rather than a single
  // day's reading — otherwise the "right" answer would depend on which day the round was played.
  if (metric.unit !== "percent") return null;
  const window = lastNPoints(metric.series, SUM_WINDOW_DAYS);
  if (window.length < MIN_SERIES_DAYS) return null;
  const average = meanValues(window);
  if (average <= 0) return null;
  return buildNumericFact(context, {
    kind: "ratio",
    trueValue: average,
    text: `Averaged over the last ${window.length} days, what is your ${metric.label.toLowerCase()}?`,
    explanation: `${metric.label}: ${metric.description}`,
  });
}

/** Below this, a swing is indistinguishable from noise and "did it go up or down" has no honest answer. */
const MIN_INTERESTING_CHANGE_PERCENT = 5;

function buildChangeFact(context: FactBuilderContext): QuizFact | null {
  const { metric, rng } = context;
  if (metric.series.length < SHORT_WINDOW_DAYS * 2) return null;
  const recent = lastNPoints(metric.series, SHORT_WINDOW_DAYS);
  const previous = metric.series.slice(metric.series.length - SHORT_WINDOW_DAYS * 2, metric.series.length - SHORT_WINDOW_DAYS);
  // Flows compare totals, snapshots compare their end-of-window levels: summing a running total over
  // 14 days would produce a number that means nothing.
  const recentValue = metric.kind === "flow" ? sumValues(recent) : recent[recent.length - 1].value;
  const previousValue = metric.kind === "flow" ? sumValues(previous) : previous[previous.length - 1].value;
  if (previousValue <= 0) return null;
  const changePercent = ((recentValue - previousValue) / previousValue) * 100;
  if (Math.abs(changePercent) < MIN_INTERESTING_CHANGE_PERCENT) return null;

  const optionValues = buildChangeOptionValues(changePercent);
  if (optionValues == null) return null;
  const labels = optionValues.map(formatSignedPercent);
  if (new Set(labels).size !== labels.length) return null;
  const { options, correctOptionId } = toOptions(labels, 0, rng);
  return {
    factId: `${metric.id}:window_change_pct`,
    metricId: metric.id,
    metricLabel: metric.label,
    metricDescription: metric.description,
    kind: "window_change_pct",
    unit: metric.unit,
    trueValue: changePercent,
    options,
    correctOptionId,
    templateText: `How did your ${metric.label.toLowerCase()} move over the last ${SHORT_WINDOW_DAYS} days, compared with the ${SHORT_WINDOW_DAYS} days before that?`,
    templateExplanation: `${metric.label}: ${metric.description}`,
  };
}

/** A weekday needs this many observations before its average means anything. */
const MIN_OBSERVATIONS_PER_WEEKDAY = 3;

function buildPeakWeekdayFact(context: FactBuilderContext): QuizFact | null {
  const { metric, rng } = context;
  // Only flows have a weekday shape: a snapshot's "Tuesday value" is just wherever the running total
  // happened to be on Tuesday, which says nothing about Tuesdays.
  if (metric.kind !== "flow" || metric.series.length < SHORT_WINDOW_DAYS * 2) return null;

  const totalsByWeekday = new Map<number, { total: number, days: number }>();
  for (const point of metric.series) {
    const weekday = weekdayIndexOf(point.date);
    if (weekday == null) return null;
    const bucket = totalsByWeekday.get(weekday) ?? { total: 0, days: 0 };
    bucket.total += point.value;
    bucket.days += 1;
    totalsByWeekday.set(weekday, bucket);
  }
  const averages = [...totalsByWeekday.entries()]
    .filter(([, bucket]) => bucket.days >= MIN_OBSERVATIONS_PER_WEEKDAY)
    .map(([weekday, bucket]) => ({ weekday, average: bucket.total / bucket.days }))
    .sort((a, b) => b.average - a.average);
  if (averages.length < OPTIONS_PER_QUESTION) return null;

  const winner = averages[0];
  if (winner.average <= 0) return null;
  // A near-tie makes the question unfair — the player would have to know the data better than the
  // data knows itself. Require the peak to stand clear of the runner-up.
  if (winner.average < averages[1].average * 1.15) return null;

  const decoys = shuffled(averages.slice(1), rng).slice(0, OPTIONS_PER_QUESTION - 1);
  const labels = [WEEKDAY_NAMES[winner.weekday], ...decoys.map((entry) => WEEKDAY_NAMES[entry.weekday])];
  const { options, correctOptionId } = toOptions(labels, 0, rng);
  return {
    factId: `${metric.id}:peak_weekday`,
    metricId: metric.id,
    metricLabel: metric.label,
    metricDescription: metric.description,
    kind: "peak_weekday",
    unit: metric.unit,
    trueValue: winner.average,
    options,
    correctOptionId,
    templateText: `Which day of the week brings you the most ${metric.label.toLowerCase()}, on average?`,
    templateExplanation: `Averaged per weekday across the last ${metric.series.length} days (UTC). ${metric.description}`,
  };
}

/**
 * "Which of these is biggest?" — the one question kind that spans metrics rather than sitting inside
 * one. Built from a group of same-unit metrics so the comparison is apples to apples.
 */
function buildRankAmongFact(metrics: readonly GrowthMetricsOverviewMetric[], rng: Rng): QuizFact | null {
  const comparable = metrics
    .filter((metric) => metric.unit === "count" && metric.kind === "flow" && hasUsableHistory(metric))
    .map((metric) => ({ metric, total: sumValues(lastNPoints(metric.series, SUM_WINDOW_DAYS)) }))
    .filter((entry) => entry.total > 0);
  if (comparable.length < OPTIONS_PER_QUESTION) return null;

  const picked = shuffled(comparable, rng).slice(0, OPTIONS_PER_QUESTION).sort((a, b) => b.total - a.total);
  const winner = picked[0];
  // Same fairness rule as the weekday question: if the top two are within noise of each other, there
  // is no answer a well-informed person could be expected to get right.
  if (winner.total < picked[1].total * 1.15) return null;

  const labels = picked.map((entry) => entry.metric.label);
  const { options, correctOptionId } = toOptions(labels, 0, rng);
  return {
    factId: `rank_among:${picked.map((entry) => entry.metric.id).join("+")}`,
    metricId: winner.metric.id,
    metricLabel: winner.metric.label,
    metricDescription: winner.metric.description,
    kind: "rank_among",
    unit: winner.metric.unit,
    trueValue: winner.total,
    options,
    correctOptionId,
    templateText: `Over the last ${SUM_WINDOW_DAYS} days, which of these was largest?`,
    templateExplanation: `${winner.metric.label} led with ${formatQuizValue(Math.round(winner.total), winner.metric.unit)}. ${winner.metric.description}`,
  };
}

// ─── Round assembly ──────────────────────────────────────────────────────────

type PerMetricBuilder = (context: FactBuilderContext) => QuizFact | null;

const PER_METRIC_BUILDERS = new Map<QuizFactKind, PerMetricBuilder>([
  ["latest_value", buildLatestValueFact],
  ["window_sum", buildWindowSumFact],
  ["ratio", buildRatioFact],
  ["window_change_pct", buildChangeFact],
  ["peak_weekday", buildPeakWeekdayFact],
]);

/**
 * Picks up to `limit` facts, at most one per metric and spread across question kinds.
 *
 * The one-per-metric rule is what stops a round from being eight variations on `new_users` for a
 * project whose other metrics are thin — that reads as a bug even though every individual question
 * is correct.
 */
function selectFacts(candidatesByKind: Map<QuizFactKind, QuizFact[]>, limit: number, rng: Rng): QuizFact[] {
  const kindOrder = shuffled([...candidatesByKind.keys()], rng);
  const queues = new Map(kindOrder.map((kind) => [kind, [...(candidatesByKind.get(kind) ?? [])]]));
  const selected: QuizFact[] = [];
  const usedMetricIds = new Set<string>();

  let madeProgress = true;
  while (selected.length < limit && madeProgress) {
    madeProgress = false;
    for (const kind of kindOrder) {
      if (selected.length >= limit) break;
      const queue = queues.get(kind) ?? [];
      // `rank_among` spans four metrics at once; letting it consume a metric slot would be wrong in
      // both directions, so it is exempt from the used-metric check and simply capped at one per
      // round by there only ever being one candidate for it.
      const nextIndex = queue.findIndex((fact) => fact.kind === "rank_among" || !usedMetricIds.has(fact.metricId));
      if (nextIndex === -1) continue;
      const [fact] = queue.splice(nextIndex, 1);
      queues.set(kind, queue);
      selected.push(fact);
      if (fact.kind !== "rank_among") usedMetricIds.add(fact.metricId);
      madeProgress = true;
    }
  }
  return selected;
}

/**
 * Builds a round's worth of questions, or reports that the project does not have enough history yet.
 *
 * The overview body already carries the catalog's label/unit/kind/description for every stored
 * metric (buildGrowthMetricsOverviewBody joins them), so the catalog is not a second parameter here —
 * one source for a metric's semantics, not two that can disagree.
 */
export function buildQuizFacts(
  overview: GrowthMetricsOverviewBody,
  options: { questionCount?: number, seed: string },
): BuildQuizFactsResult {
  const questionCount = options.questionCount ?? DEFAULT_QUIZ_QUESTION_COUNT;
  const rng = createRng(options.seed);

  // Ads metrics ride in `ad_accounts` rather than `metrics` precisely because their dates are
  // ad-account-local; the filter here is belt-and-braces so a future catalog change cannot quietly
  // introduce a question whose "day" means something different from every other question's.
  const usable = overview.metrics.filter((metric) => metric.unit !== "minor_units" && hasUsableHistory(metric));

  const candidatesByKind = new Map<QuizFactKind, QuizFact[]>();
  for (const [kind, build] of PER_METRIC_BUILDERS) {
    const facts = usable.map((metric) => build({ metric, rng })).filter((fact): fact is QuizFact => fact != null);
    if (facts.length > 0) candidatesByKind.set(kind, shuffled(facts, rng));
  }
  const rankAmong = buildRankAmongFact(usable, rng);
  if (rankAmong != null) candidatesByKind.set("rank_among", [rankAmong]);

  // How many questions this project could support at most, independent of the requested count. This
  // is the number the gate is judged on: asking for 8 and getting 7 is a fine round, getting 3 is
  // not a quiz.
  const answerable = selectFacts(candidatesByKind, Number.MAX_SAFE_INTEGER, createRng(options.seed));
  if (answerable.length < MIN_ANSWERABLE_FACTS) {
    return { status: "insufficient", answerableCount: answerable.length, required: MIN_ANSWERABLE_FACTS };
  }

  return {
    status: "ok",
    facts: selectFacts(candidatesByKind, questionCount, rng),
    metricsAsOf: overview.latest_stored_date,
  };
}

/**
 * Whether this project can play at all, without paying for the full build. Used by the games hub to
 * render the gate; `buildQuizFacts` re-checks it, so this is a display concern rather than the
 * enforcement point.
 */
export function countAnswerableQuizFacts(overview: GrowthMetricsOverviewBody): number {
  const result = buildQuizFacts(overview, { seed: "eligibility-probe", questionCount: DEFAULT_QUIZ_QUESTION_COUNT });
  return result.status === "ok" ? Math.max(result.facts.length, MIN_ANSWERABLE_FACTS) : result.answerableCount;
}
