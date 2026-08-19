import { describe, expect, it } from "vitest";
import { SHARED_PROMPT_RULES } from "#lib/run-analysis-phase.ts";

describe("SHARED_PROMPT_RULES", () => {
  it("forbids claiming an ad ever ran, launched, or spent", () => {
    // Cheap regression guard on prompt text doing real safety work. The agent can write anything
    // into a report or brief, and "we launched your campaign" is a claim the customer has no way to
    // check — so the clause forbidding it is the only thing standing between the model and a lie.
    expect(SHARED_PROMPT_RULES).toContain("Paid acquisition");
    expect(SHARED_PROMPT_RULES).toContain("never launch, publish, pause, or spend");
    expect(SHARED_PROMPT_RULES).toContain("Never write or imply that an ad is running");
  });

  it("tells the model it has no ad-account read either, so it cannot invent performance numbers", () => {
    expect(SHARED_PROMPT_RULES).toContain("cannot read a project's ad account");
  });
});
