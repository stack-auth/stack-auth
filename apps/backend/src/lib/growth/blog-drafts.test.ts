import { describe, expect, it } from "vitest";
import { extractGrowthBlogDraftMarkdown, extractGrowthBlogIdea, parseGrowthBlogDraftResponse } from "./blog-drafts";

// The payload column is an opaque Json written by the agent, so every reader here is a trust
// boundary: a malformed shape must degrade to "no idea / no draft", never to a crash or to a
// half-parsed object that makes the UI claim a draft exists.
describe("extractGrowthBlogIdea", () => {
  it("reads a full idea", () => {
    expect(extractGrowthBlogIdea({
      blog_idea: {
        title: "Plannery vs TaskHive",
        target_intent: "taskhive alternative",
        aeo_angle: "Which tracker is better for freelancers?",
        outline_summary: "Compare onboarding speed and free-tier limits.",
      },
    })).toEqual({
      title: "Plannery vs TaskHive",
      targetIntent: "taskhive alternative",
      aeoAngle: "Which tracker is better for freelancers?",
      outlineSummary: "Compare onboarding speed and free-tier limits.",
    });
  });

  it("keeps the idea usable when only the title was grounded", () => {
    expect(extractGrowthBlogIdea({ blog_idea: { title: "Just a title" } })).toEqual({
      title: "Just a title",
      targetIntent: null,
      aeoAngle: null,
      outlineSummary: null,
    });
  });

  it("treats blank and non-string optional fields as absent rather than empty strings", () => {
    expect(extractGrowthBlogIdea({
      blog_idea: { title: "T", target_intent: "   ", aeo_angle: 42, outline_summary: null },
    })).toEqual({ title: "T", targetIntent: null, aeoAngle: null, outlineSummary: null });
  });

  it.each([
    ["null payload", null],
    ["a non-object payload", "nope"],
    ["an array payload", []],
    ["a payload with no idea", { draft_markdown: "# hi" }],
    ["an idea that is not an object", { blog_idea: "Plannery vs TaskHive" }],
    ["an idea with no title", { blog_idea: { target_intent: "x" } }],
    ["an idea with a blank title", { blog_idea: { title: "  " } }],
  ])("returns null for %s", (_label, payload) => {
    expect(extractGrowthBlogIdea(payload)).toBeNull();
  });
});

describe("extractGrowthBlogDraftMarkdown", () => {
  it("reads a stored draft", () => {
    expect(extractGrowthBlogDraftMarkdown({ draft_markdown: "# Post" })).toBe("# Post");
  });

  it.each([
    ["null", null],
    ["a blank draft", { draft_markdown: "   " }],
    ["a non-string draft", { draft_markdown: 5 }],
    ["an idea-only payload", { blog_idea: { title: "T" } }],
  ])("returns null for %s", (_label, payload) => {
    expect(extractGrowthBlogDraftMarkdown(payload)).toBeNull();
  });
});

describe("parseGrowthBlogDraftResponse", () => {
  it("returns the markdown", () => {
    expect(parseGrowthBlogDraftResponse({ draft_markdown: "# Post" })).toBe("# Post");
  });

  it.each([
    ["a non-object response", "# Post"],
    ["a missing field", {}],
    ["an empty draft", { draft_markdown: "" }],
    ["a whitespace-only draft", { draft_markdown: "\n  \n" }],
  ])("throws a retryable 502 for %s, so nothing is stored", (_label, response) => {
    // Loud on purpose: storing an empty draft would make the item look generated and hide the
    // failure behind a blank card.
    expect(() => parseGrowthBlogDraftResponse(response)).toThrow();
  });
});
