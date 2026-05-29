import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

let tempDir: string | undefined;

function writeTempConfig(content: string): string {
  tempDir ??= mkdtempSync(join(tmpdir(), "stack-rde-config-"));
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
});
