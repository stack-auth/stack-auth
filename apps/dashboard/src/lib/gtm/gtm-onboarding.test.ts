import { describe, expect, it } from "vitest";
import { validateGtmOnboardingInput } from "./gtm-onboarding";

describe("validateGtmOnboardingInput", () => {
  const validInput = { domain: "https://example.com", phone: "+1 (415) 555-0100", notes: "We are launching a new pricing page." };

  it("accepts a complete website URL, phone number, and optional notes", () => {
    expect(validateGtmOnboardingInput(validInput)).toBeNull();
    expect(validateGtmOnboardingInput({ ...validInput, domain: "" })).toBeNull();
    expect(validateGtmOnboardingInput({ ...validInput, notes: "" })).toBeNull();
  });

  it("requires an actionable website URL and phone number", () => {
    expect(validateGtmOnboardingInput({ ...validInput, domain: "example.com" })).toMatchInlineSnapshot('"Use a complete website URL, beginning with http:// or https://."');
    expect(validateGtmOnboardingInput({ ...validInput, phone: "abc" })).toMatchInlineSnapshot('"Add a phone number so our team can reach you."');
  });

  it("keeps the client-side note limit aligned with the intake endpoint", () => {
    expect(validateGtmOnboardingInput({ ...validInput, notes: "x".repeat(2001) })).toMatchInlineSnapshot('"Keep your notes to 2,000 characters or fewer."');
  });
});
