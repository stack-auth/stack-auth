import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let tempDir: string | undefined;

function writeTempConfig(content: string): string {
  tempDir ??= mkdtempSync(join(process.cwd(), ".stack-rde-config-test-"));
  const configPath = join(tempDir, "stack.config.ts");
  writeFileSync(configPath, content, "utf-8");
  return configPath;
}

afterEach(() => {
  vi.resetModules();
  if (tempDir != null) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
});

describe("remote development environment config file", () => {
  it("loads config exports wrapped in defineStackConfig", async () => {
    const configPath = writeTempConfig(`
      import { defineStackConfig } from "@hexclave/shared/config";

      export const config = defineStackConfig({
        auth: {
          allowSignUp: true,
        },
      });
    `);

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": true,
          },
        },
        "showOnboarding": false,
      }
    `);
  });

  it("loads config exports wrapped in defineHexclaveConfig", async () => {
    const configPath = writeTempConfig(`
      import { defineHexclaveConfig } from "@hexclave/shared/config";

      export const config = defineHexclaveConfig({
        auth: {
          allowSignUp: false,
        },
      });
    `);

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": false,
          },
        },
        "showOnboarding": false,
      }
    `);
  });

  it("loads config exports produced by TypeScript function calls", async () => {
    const configPath = writeTempConfig(`
      function makeConfig() {
        return {
          auth: {
            allowSignUp: true,
          },
        };
      }

      export const config = makeConfig();
    `);

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": true,
          },
        },
        "showOnboarding": false,
      }
    `);
  });

  it("reloads the config module after the file changes", async () => {
    const configPath = writeTempConfig(`
      export const config = {
        auth: {
          allowSignUp: true,
        },
      };
    `);
    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": true,
          },
        },
        "showOnboarding": false,
      }
    `);

    writeFileSync(configPath, `
      export const config = {
        auth: {
          allowSignUp: false,
        },
      };
    `, "utf-8");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": false,
          },
        },
        "showOnboarding": false,
      }
    `);
  });

  it("treats the onboarding placeholder as an empty config", async () => {
    const configPath = writeTempConfig(`
      export const config = "show-onboarding";
    `);

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {},
        "showOnboarding": true,
      }
    `);
  });

  it("rejects modules without a valid config export", async () => {
    const configPath = writeTempConfig(`
      export const config = () => ({ auth: { allowSignUp: true } });
    `);

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).rejects.toThrow(`Invalid config in ${configPath}.`);
  });

  it("can rewrite a dynamic config into the rendered static format", async () => {
    const configPath = writeTempConfig(`
      export const config = {
        auth: {
          allowSignUp: false,
        },
      };
    `);
    const { readConfigFile, writeConfigObject } = await import("./config-file");
    const current = await readConfigFile(configPath);

    writeConfigObject(configPath, {
      ...current.config,
      "payments.testMode": true,
    });

    expect(readFileSync(configPath, "utf-8")).toMatchInlineSnapshot(`
      "import type { StackConfig } from "@hexclave/js";

      export const config: StackConfig = {
        "auth": {
          "allowSignUp": false
        },
        "payments": {
          "testMode": true
        }
      };
      "
    `);
    await expect(readConfigFile(configPath)).resolves.toMatchInlineSnapshot(`
      {
        "config": {
          "auth": {
            "allowSignUp": false,
          },
          "payments": {
            "testMode": true,
          },
        },
        "showOnboarding": false,
      }
    `);
  });
});
