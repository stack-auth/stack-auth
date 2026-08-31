import { GROWTH_DOCUMENT_UNITS } from "./growth-document";
import type { GrowthCategory, GrowthActionItem, GrowthOverviewFinding } from "./growth-types";

const CATEGORY_LABELS: Record<GrowthCategory, string> = {
  product: "Product",
  reach: "Reach",
  conversion: "Conversion",
  retention: "Retention",
  revenue: "Revenue",
};

export function growthCategoryLabel(category: GrowthCategory): string {
  return CATEGORY_LABELS[category];
}

const FORMAT_BRIEF = `You are writing a page that a customer of a growth product reads under one stage of their growth funnel. It replaces a raw list of AI findings, so it must read as a short, confident argument: what we saw, what it means, and what to do next.

Output format: a constrained MDX dialect called growth-mdx-v1. A strict compiler rejects anything else, so use ONLY:

- Markdown: "##" and "###" headings, paragraphs (max 360 characters each), ordered/unordered lists (max 7 items), GFM tables (max 8 rows), fenced code blocks, thematic breaks, bold/italic/strikethrough/inline code, and links with absolute http(s) or mailto URLs.
- Callout components, each wrapping its own paragraphs: <Evidence>, <Hypothesis>, <Experiment>, <DataGap>. <Hypothesis> and <Experiment> may take confidence="low|medium|high".
- Data components, self-closing and referencing a data id: <Metric data="id" />, <TrendChart data="id" />, <ComparisonChart data="id" />, <BreakdownChart data="id" />.
- Action buttons: <ActionButton action="ACTION_ID" />, self-closing, using an action id given below. This renders the real action with its live status and its activate/dismiss controls.

No raw HTML, no JSX other than the components above, no imports, no expressions, no attributes other than the ones listed.

Return exactly two things:

1. A fenced "mdx" block with the page body.
2. A fenced "json" block with the evidence data array the data components reference: a JSON array of objects with "id", "kind" ("metric" | "time_series" | "comparison" | "breakdown"), "title", "unit" (${GROWTH_DOCUMENT_UNITS.join(" | ")}), "source", "takeaway", optional "timezone", "currency" (required, three-letter ISO, when unit is "minor_units"), plus "value" (+ optional "comparison_label" and "comparison_value") for a metric, "series" of {label, points:[{label, value}]} for a time series, or "items" of {label, value} for a comparison or breakdown. Use [] if the page references no data components. Never invent numbers: only use figures that appear in the material below.

Write for the customer, not for us: no mention of AI, agents, findings, notes, or internal tooling.`;

function bulletList(label: string, values: string[]): string[] {
  if (values.length === 0) return [];
  return [`${label}: ${values.join(", ")}`];
}

function formatDate(millis: number): string {
  return new Date(millis).toISOString().slice(0, 10);
}

function actionLines(action: GrowthActionItem): string[] {
  const lines = [
    `- Action id: ${action.id}  (use as <ActionButton action="${action.id}" />)`,
    `  Title: ${action.title}`,
    `  Type: ${action.typeId}`,
    `  Status: ${action.status}`,
    `  Proposed: ${formatDate(action.createdAtMillis)}`,
    `  Description: ${action.description}`,
  ];
  for (const line of bulletList("  Tags", action.tags)) lines.push(line);
  if (action.watchedMetrics.length > 0) {
    lines.push(`  Watched metrics: ${action.watchedMetrics.map((metric) => `${metric.metricId} over ${metric.windowDays} days`).join(", ")}`);
  }
  if (action.workflow != null) {
    lines.push(`  Automation: ${action.workflow.explanation}`);
    lines.push(`  Undoing the automation: ${action.workflow.rollbackNote}`);
  }
  if (action.document != null) {
    lines.push(`  Existing narrative (growth-mdx-v1, may be reused):`);
    for (const line of action.document.sourceMdx.split("\n")) lines.push(`    ${line}`);
  }
  return lines;
}

function findingLines(finding: GrowthOverviewFinding, noun: "Finding" | "Note"): string[] {
  const lines = [
    `- ${noun} id: ${finding.id}`,
    `  Title: ${finding.title}`,
    `  Source: ${finding.source} (${finding.kind})`,
    `  Recorded: ${formatDate(finding.createdAtMillis)}`,
    `  Body: ${finding.body}`,
  ];
  for (const line of bulletList("  Tags", finding.tags)) lines.push(line);
  if (finding.document != null) {
    lines.push(`  Existing narrative (growth-mdx-v1, may be reused):`);
    for (const line of finding.document.sourceMdx.split("\n")) lines.push(`    ${line}`);
  }
  return lines;
}

export function buildGrowthItemPagePrompt(input:
  | { kind: "finding" | "note", category: GrowthCategory, finding: GrowthOverviewFinding }
  | { kind: "action", category: GrowthCategory, action: GrowthActionItem },
): string {
  const sections = [
    FORMAT_BRIEF,
    `Stage: ${growthCategoryLabel(input.category)}`,
    input.kind === "action"
      ? ["Material — one suggested action:", ...actionLines(input.action)].join("\n")
      : ["Material — one observation:", ...findingLines(input.finding, input.kind === "note" ? "Note" : "Finding")].join("\n"),
  ];
  return sections.join("\n\n");
}

export function buildGrowthCategoryPagePrompt(input: {
  category: GrowthCategory,
  score: number | null,
  findings: GrowthOverviewFinding[],
  notes: GrowthOverviewFinding[],
  actions: GrowthActionItem[],
}): string {
  const material: string[] = [];
  if (input.findings.length > 0) {
    material.push("Observations from analysis:");
    for (const finding of input.findings) material.push(...findingLines(finding, "Finding"));
  }
  if (input.notes.length > 0) {
    material.push("Notes:");
    for (const note of input.notes) material.push(...findingLines(note, "Note"));
  }
  if (input.actions.length > 0) {
    material.push("Suggested actions (only these ids may be used in <ActionButton>):");
    for (const action of input.actions) material.push(...actionLines(action));
  }
  if (material.length === 0) material.push("No material has been recorded for this stage yet.");

  return [
    FORMAT_BRIEF,
    `Stage: ${growthCategoryLabel(input.category)}${input.score == null ? "" : ` (current stage score: ${input.score}/100)`}`,
    material.join("\n"),
  ].join("\n\n");
}
