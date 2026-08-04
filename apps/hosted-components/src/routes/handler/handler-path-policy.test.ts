import { describe, expect, it } from "vitest";
import { isCanonicalHandlerPathOrAlias } from "./handler-path-policy";

describe("hosted handler path policy", () => {
  it.each([
    "sign-out",
    "oauth-callback",
    "magic-link-callback",
    "SIGNOUT",
    "OAuthCallback",
    "magiclinkcallback",
    "log-in",
    "login",
    "register",
  ])("preserves canonical generic pages and aliases for %s", (handlerPath) => {
    expect(isCanonicalHandlerPathOrAlias(handlerPath)).toBe(true);
  });

  it.each([
    "",
    "unknown",
    "oauth-callback/extra",
    "go-home",
  ])("rejects unknown handler path %s", (handlerPath) => {
    expect(isCanonicalHandlerPathOrAlias(handlerPath)).toBe(false);
  });
});
