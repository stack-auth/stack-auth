import { describe, expect, it } from "vitest";
import { growthActionDocumentInputSchema } from "./growth-document.ts";

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
      data: [{
        id: "activation",
        kind: "metric",
        title: "New-user activation",
        unit: "percent",
        source: "Product events, last 30 days",
        takeaway: "New-user activation is below the current target.",
        value: 12,
      }],
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
