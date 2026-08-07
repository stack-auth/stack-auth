import { describe, expect, it } from "vitest";

import {
  estimatePromptTokenCount,
  formatApproximateTokenCountLabel,
} from "./setup-prompt";

describe("estimatePromptTokenCount", () => {
  it("uses roughly one token per four characters", () => {
    expect(estimatePromptTokenCount("abcd")).toBe(1);
    expect(estimatePromptTokenCount("abcdefgh")).toBe(2);
    expect(estimatePromptTokenCount("a".repeat(401))).toBe(100);
  });

  it("never reports fewer than one token for non-empty text", () => {
    expect(estimatePromptTokenCount("a")).toBe(1);
  });
});

describe("formatApproximateTokenCountLabel", () => {
  it("formats with a tilde and thousands separators", () => {
    expect(formatApproximateTokenCountLabel("a".repeat(60_000))).toBe("~15,000 tokens");
  });
});
