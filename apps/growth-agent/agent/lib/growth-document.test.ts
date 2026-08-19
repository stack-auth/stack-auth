import { describe, expect, it } from "vitest";
import { growthActionDocumentInputSchema, growthDocumentInputSchema } from "./growth-document.ts";

const metricData = {
  id: "activation",
  kind: "metric",
  title: "New-user activation",
  unit: "percent",
  source: "Product events, last 30 days",
  takeaway: "New-user activation is below the current target.",
  value: 12,
};

function parseDocument(source_mdx: string) {
  return growthDocumentInputSchema.safeParse({
    format: "growth-mdx-v1",
    source_mdx,
    data: [metricData],
  });
}

describe("growthDocumentInputSchema", () => {
  it("accepts valid block-level Growth MDX", () => {
    expect(parseDocument(`## Activation

<Metric data="activation" />

<Evidence data="activation">

Only 12% of new signups activated in the measured window.

</Evidence>`).success).toBe(true);
  });

  it("does not interpret component-like text or expressions inside code as MDX", () => {
    expect(parseDocument(`## Implementation note

\`{value}\`

\`\`\`tsx
<Metric data-id="example" />
const example = { value: 1 };
\`\`\``).success).toBe(true);
  });

  it.each([
    ["the unsupported data-id attribute", '<Metric data-id="activation" />', /data attribute, not data-id/],
    ["an inline component", 'Activation is low: <Metric data="activation" />', /block-level component/],
    ["malformed MDX", '<Metric data="activation" /', /malformed or unterminated/],
    ["an unclosed component", '<Evidence data="activation">\n\nActivation is low.', /missing its closing tag/],
    ["an oversized paragraph", "a".repeat(361), /at most 360 characters/],
  ])("rejects %s before a save tool can call the backend", (_label, sourceMdx, expectedMessage) => {
    const result = parseDocument(sourceMdx);

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toMatch(expectedMessage);
  });

  it("rejects a metric component whose data item has the wrong kind", () => {
    const result = growthDocumentInputSchema.safeParse({
      format: "growth-mdx-v1",
      source_mdx: '<Metric data="activation" />',
      data: [{
        id: "activation",
        kind: "comparison",
        title: "Activation",
        unit: "percent",
        source: "Product events",
        takeaway: "Activation varies by source.",
        items: [{ label: "Organic", value: 12 }],
      }],
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.message).toMatch(/Metric requires metric data/);
  });
});

describe("growthActionDocumentInputSchema", () => {
  it("accepts the fixed hypothesis, evidence, experiment sequence", () => {
    const result = growthActionDocumentInputSchema.safeParse({
      format: "growth-mdx-v1",
      source_mdx: `<Hypothesis confidence="medium">

The signup prompt is too vague for first-time visitors.

</Hypothesis>

<Evidence data="activation">

Only 12% of new signups activated in the measured window.

</Evidence>

<Experiment>

Test a specific signup prompt for 14 days. Success means activation exceeds 15%.

</Experiment>`,
      data: [metricData],
    });

    expect(result.success).toBe(true);
  });

  it("rejects model-authored headings and extra action sections", () => {
    const result = growthActionDocumentInputSchema.safeParse({
      format: "growth-mdx-v1",
      source_mdx: "## Hypothesis\n\n<Hypothesis confidence=\"medium\">Test</Hypothesis>\n\n<Evidence>Proof</Evidence>\n\n<Experiment>Run it</Experiment>\n\n## Action\n\nDeploy it",
      data: [],
    });

    expect(result.success).toBe(false);
  });
});
