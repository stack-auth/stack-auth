import { describe, expect, it } from "vitest";
import { KnownErrors } from "@hexclave/shared";
import { validateAuthorizedParty } from "./external-auth";

describe("Clerk authorized parties", () => {
  it("allows verification to proceed when the optional allowlist is blank", () => {
    expect(() => validateAuthorizedParty({ azp: undefined }, undefined)).not.toThrow();
  });

  it("rejects a token whose azp does not match a configured allowlist", () => {
    expect(() => validateAuthorizedParty({ azp: "https://unexpected.example.com" }, ["http://localhost:8115"])).toThrowError(
      expect.objectContaining({
        constructorArgs: ["authorized_party_mismatch"],
      }),
    );
  });
});

describe("external authentication diagnostics", () => {
  it.each([
    "malformed_token",
    "signature_mismatch",
    "expired",
    "issuer_mismatch",
    "audience_mismatch",
    "authorized_party_mismatch",
    "client_id_mismatch",
    "missing_claim",
  ] as const)("preserves invalid-token reason %s", (reason) => {
    const error = new KnownErrors.InvalidExternalAuthToken(reason);
    expect(error.details).toMatchObject({ reason });
    expect(error.message).toContain(`(${reason})`);
  });

  it.each([
    "provider_disabled",
    "required_setting_missing",
    "invalid_authorized_party",
  ] as const)("preserves provider-configuration reason %s", (reason) => {
    const error = new KnownErrors.ExternalAuthProviderNotConfigured(reason);
    expect(error.details).toMatchObject({ reason });
    expect(error.message).toContain(`(${reason})`);
  });
});
