import { z } from "zod";

const evidenceBase = {
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  unit: z.enum(["count", "cents", "percent", "seconds", "minor_units"]),
  source: z.string().min(1).max(500),
  takeaway: z.string().min(1).max(360),
  timezone: z.string().min(1).max(100).optional(),
  currency: z.string().length(3).optional(),
};

const pointSchema = z.object({
  label: z.string().min(1).max(100),
  value: z.number().finite(),
});

const evidenceDatumSchema = z.discriminatedUnion("kind", [
  z.object({
    ...evidenceBase,
    kind: z.literal("metric"),
    value: z.number().finite(),
    comparison_label: z.string().min(1).max(100).optional(),
    comparison_value: z.number().finite().optional(),
  }),
  z.object({
    ...evidenceBase,
    kind: z.literal("time_series"),
    series: z.array(z.object({
      label: z.string().min(1).max(100),
      points: z.array(pointSchema).min(1).max(90),
    })).min(1).max(3),
  }),
  z.object({ ...evidenceBase, kind: z.literal("comparison"), items: z.array(pointSchema).min(1).max(8) }),
  z.object({ ...evidenceBase, kind: z.literal("breakdown"), items: z.array(pointSchema).min(1).max(8) }),
]);

/**
 * Model-facing source document. The backend compiles this restricted MDX to a safe render tree;
 * models never send JSX AST or executable code, which keeps the tool schema provider-friendly.
 */
export const growthDocumentInputSchema = z.object({
  format: z.literal("growth-mdx-v1"),
  source_mdx: z.string().min(1).max(100_000),
  data: z.array(evidenceDatumSchema).max(40),
});

export type GrowthDocumentInput = z.infer<typeof growthDocumentInputSchema>;

const ACTION_COMPONENT_PATTERN = /<(Hypothesis|Evidence|Experiment)\b[^>]*>[\s\S]*?<\/\1>/g;

/**
 * Action suggestions intentionally have a smaller grammar than reports and findings. The product
 * owns their three-section layout, so the model may only provide the text inside these components.
 * This validation complements the dashboard renderer, which independently ignores arbitrary
 * headings and prose in action documents saved before this contract existed.
 */
export const growthActionDocumentInputSchema = growthDocumentInputSchema.superRefine((document, ctx) => {
  const components = [...document.source_mdx.matchAll(ACTION_COMPONENT_PATTERN)];
  const names = components.map((match) => match[1]);
  const remainingSource = document.source_mdx.replace(ACTION_COMPONENT_PATTERN, "").trim();
  const hasExactSequence = names.length >= 3
    && names[0] === "Hypothesis"
    && names.at(-1) === "Experiment"
    && names.slice(1, -1).every((name) => name === "Evidence");
  if (!hasExactSequence || remainingSource.length > 0) {
    ctx.addIssue({
      code: "custom",
      message: "Action documents must contain exactly one Hypothesis, one or more Evidence blocks, and exactly one Experiment, in that order, with no headings or free-standing prose.",
    });
  }
});

export const GROWTH_DOCUMENT_AUTHORING_GUIDE = `Use constrained Growth MDX. Keep paragraphs under 360 characters and lists under 8 items. Allowed headings are ## and ###. Allowed components are <Metric data="id" />, <TrendChart data="id" />, <ComparisonChart data="id" />, <BreakdownChart data="id" />, <Evidence data="id">...</Evidence>, <Hypothesis confidence="low|medium|high">...</Hypothesis>, <Experiment>...</Experiment>, and <DataGap>...</DataGap>. Every chart or metric must reference a matching data item with a source and one-sentence takeaway. Evidence with unit minor_units must include its three-letter currency; other units must omit currency. No HTML, imports, exports, JavaScript expressions, images, or arbitrary components. Prefer a scan-friendly sequence: evidence, hypothesis, experiment, success metric, and action.`;

export const GROWTH_ACTION_DOCUMENT_AUTHORING_GUIDE = `Use exactly this Growth MDX structure, in this order: <Hypothesis confidence="low|medium|high">...</Hypothesis>, one or more <Evidence data="id">...</Evidence> blocks, then <Experiment>...</Experiment>. Do not add headings, success-metric sections, action sections, charts, standalone paragraphs, or any other components. Put the proposed change, test duration, and measurable success criteria inside Experiment. Every Evidence block must reference a matching data item with a named source and one-sentence takeaway. The dashboard owns every label and all layout; you write only the text inside these three component types.`;
