import { afterEach, describe, expect, it, vi } from "vitest";
import { getConfigForInternalConfigResponse } from "./route";

describe("getConfigForInternalConfigResponse", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("injects the configured sender email for shared email server configs", () => {
    vi.stubEnv("STACK_EMAIL_SENDER", "noreply@lolcalho.st");
    const config = {
      emails: {
        server: {
          isShared: true,
          senderEmail: undefined,
        },
      },
      untouched: "value",
    };

    const result = getConfigForInternalConfigResponse(config);

    expect(result).toEqual({
      emails: {
        server: {
          isShared: true,
          senderEmail: "noreply@lolcalho.st",
        },
      },
      untouched: "value",
    });
    expect(config.emails.server.senderEmail).toBeUndefined();
  });
});
