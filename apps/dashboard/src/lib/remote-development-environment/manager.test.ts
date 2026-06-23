import { describe, expect, it } from "vitest";
import { formatConfigSyncErrorForCli } from "./config-sync-error-format";

describe("formatConfigSyncErrorForCli", () => {
  it("extracts the backend config validation message without stack details", () => {
    const message = formatConfigSyncErrorForCli(
      "/Users/example/app/hexclave.config.ts",
      new Error(`Failed to send request to http://127.0.0.1:9202/api/v1/internal/config/override/branch: 400 The key "abcd" is not valid (nested object not found in schema: "abcd").
  Stack:
    at sendClientRequestInner (/internal/chunk.js:1:1)
  Cause:
    Response { "status": 400, "headers": Headers {} }`),
    );

    expect(message).toBe(`Config file error: The key "abcd" is not valid (nested object not found in schema: "abcd"). Please check your config file at /Users/example/app/hexclave.config.ts.`);
  });

  it("keeps generic sync failures concise and actionable", () => {
    const message = formatConfigSyncErrorForCli(
      "/Users/example/app/hexclave.config.ts",
      new Error(`Unexpected token '}' in JSON
  Stack:
    at readConfigFile (/internal/chunk.js:1:1)`),
    );

    expect(message).toBe("Config file error: Unexpected token '}' in JSON Please check your config file at /Users/example/app/hexclave.config.ts.");
    expect(message).not.toContain("Stack:");
  });
});
