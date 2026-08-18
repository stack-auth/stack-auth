import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { GrowthDocument } from "@/lib/growth/growth-document";
import { GrowthDocumentRenderer } from "./growth-document";

describe("GrowthDocumentRenderer", () => {
  it("renders the safe tree as scan-friendly semantic content", () => {
    const document: GrowthDocument = {
      format: "growth-mdx-v1",
      sourceMdx: "## What changed\n\n<Experiment>Test the shorter onboarding flow.</Experiment>",
      blocks: [
        { type: "heading", level: 2, children: [{ type: "text", value: "What changed" }] },
        {
          type: "component",
          name: "Experiment",
          dataId: null,
          confidence: null,
          children: [{ type: "paragraph", children: [{ type: "text", value: "Test the shorter onboarding flow." }] }],
        },
      ],
      data: [],
    };

    const html = renderToStaticMarkup(<GrowthDocumentRenderer document={document} />);
    expect(html).toContain("<h2");
    expect(html).toContain("What changed");
    expect(html).toContain("<aside");
    expect(html).toContain("Experiment");
    expect(html).toContain("Test the shorter onboarding flow.");
  });
});
