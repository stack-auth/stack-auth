import { describe, expect, it } from "vitest";
import { validateAuthorizedParty } from "./external-auth";

describe("Clerk authorized parties", () => {
  it("allows verification to proceed when the optional allowlist is blank", () => {
    expect(() => validateAuthorizedParty({ azp: undefined }, undefined)).not.toThrow();
  });

  it("rejects a token whose azp does not match a configured allowlist", () => {
    expect(() => validateAuthorizedParty({ azp: "https://unexpected.example.com" }, ["http://localhost:8115"])).toThrow();
  });
});
