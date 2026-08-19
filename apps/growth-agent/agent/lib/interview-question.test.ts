import { describe, expect, it } from "vitest";
import {
  founderInterviewPromptSchema,
  FOUNDER_INTERVIEW_PROMPT_GUIDANCE,
  FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH,
} from "#lib/interview-question.ts";

describe("founder interview prompt contract", () => {
  it("accepts a concise evidence sentence followed by one focused question", () => {
    const prompt = "Search visitors activated at 18%, twice the project average. What makes those visitors different?";
    expect(founderInterviewPromptSchema.parse(prompt)).toBe(prompt);
  });

  it("reserves enough room for evidence without allowing essay-length cards", () => {
    expect(FOUNDER_INTERVIEW_PROMPT_MAX_LENGTH).toBe(300);
    expect(() => founderInterviewPromptSchema.parse("x".repeat(301))).toThrow();
  });

  it("tells the authoring model to use project evidence and ask only what remains unknown", () => {
    expect(FOUNDER_INTERVIEW_PROMPT_GUIDANCE).toContain("two short sentences");
    expect(FOUNDER_INTERVIEW_PROMPT_GUIDANCE).toContain("project's evidence");
    expect(FOUNDER_INTERVIEW_PROMPT_GUIDANCE).toContain("evidence already establishes");
  });
});
