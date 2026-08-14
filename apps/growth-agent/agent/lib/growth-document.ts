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

export const GROWTH_DOCUMENT_AUTHORING_GUIDE = `Use constrained Growth MDX. Keep paragraphs under 360 characters and lists under 8 items. Allowed headings are ## and ###. Allowed components are <Metric data="id" />, <TrendChart data="id" />, <ComparisonChart data="id" />, <BreakdownChart data="id" />, <Evidence data="id">...</Evidence>, <Hypothesis confidence="low|medium|high">...</Hypothesis>, <Experiment>...</Experiment>, and <DataGap>...</DataGap>. Every chart or metric must reference a matching data item with a source and one-sentence takeaway. Evidence with unit minor_units must include its three-letter currency; other units must omit currency. No HTML, imports, exports, JavaScript expressions, images, or arbitrary components. Prefer a scan-friendly sequence: evidence, hypothesis, experiment, success metric, and action.`;
