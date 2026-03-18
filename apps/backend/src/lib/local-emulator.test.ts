import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfigFromFile } from "./local-emulator";

describe("local emulator config", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("reads config from STACK_LOCAL_EMULATOR_CONFIG_CONTENT env var when set", async () => {
    const content = `export const config = { auth: { allowLocalhost: true } };\n`;
    vi.stubEnv("STACK_LOCAL_EMULATOR_CONFIG_CONTENT", Buffer.from(content).toString("base64"));

    await expect(readConfigFromFile("/irrelevant/path/stack.config.ts")).resolves.toMatchInlineSnapshot(`
      {
        "auth": {
          "allowLocalhost": true,
        },
      }
    `);
  });

  it("returns empty object when env var is not set and file does not exist", async () => {
    await expect(readConfigFromFile("/nonexistent/stack.config.ts")).resolves.toEqual({});
  });

  it("returns empty object when env var content is empty", async () => {
    const content = ``;
    vi.stubEnv("STACK_LOCAL_EMULATOR_CONFIG_CONTENT", Buffer.from(content).toString("base64"));

    await expect(readConfigFromFile("/irrelevant/path/stack.config.ts")).resolves.toEqual({});
  });
});
