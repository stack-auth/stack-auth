import { describe, expect, it } from "vitest";
import { scopePasskeyAuthenticationToHostname, scopePasskeyRegistrationToHostname } from "./passkey-rp-id";

const passkeyRpIdSentinel = "THIS_VALUE_WILL_BE_REPLACED.example.com";

describe.each([
  "project-id.built-with-hexclave.com",
  "project-id.built-with-stack-auth.com",
])("passkeys on %s", (hostname) => {
  it("scopes registration to the current hostname", () => {
    const options = { rp: { id: passkeyRpIdSentinel } };

    scopePasskeyRegistrationToHostname(options, hostname);

    expect(options.rp.id).toBe(hostname);
  });

  it("scopes authentication to the current hostname", () => {
    const options = { rpId: passkeyRpIdSentinel };

    scopePasskeyAuthenticationToHostname(options, hostname);

    expect(options.rpId).toBe(hostname);
  });
});

it("rejects registration options without the server sentinel", () => {
  expect(() => scopePasskeyRegistrationToHostname(
    { rp: { id: "unexpected.example.com" } },
    "project-id.built-with-hexclave.com",
  )).toThrow("Expected returned RP ID from server to equal sentinel");
});

it("rejects authentication options without the server sentinel", () => {
  expect(() => scopePasskeyAuthenticationToHostname(
    { rpId: "unexpected.example.com" },
    "project-id.built-with-hexclave.com",
  )).toThrow("Expected returned RP ID from server to equal sentinel");
});
