import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Root temp config files next to this test file (inside apps/dashboard) rather
// than at process.cwd() (the repo root under vitest's workspace runner). This
// lets jiti resolve workspace packages like `@hexclave/next/config` the same
// way a real user project would — walking up to apps/dashboard/node_modules.
const TEST_FILE_DIR = dirname(fileURLToPath(import.meta.url));

let tempDir: string | undefined;

function createTempDir(): string {
  tempDir ??= mkdtempSync(join(TEST_FILE_DIR, ".stack-rde-config-test-"));
  return tempDir;
}

function writeTempConfig(content: string): string {
  const configPath = join(createTempDir(), "stack.config.ts");
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
      import { defineStackConfig } from "@hexclave/next/config";

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
      import { defineHexclaveConfig } from "@hexclave/next/config";

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

  it("throws a helpful error when the config file imports a module that fails to load", async () => {
    // Simulate a heavy framework package (e.g. @stackframe/stack) that throws on import
    const dir = createTempDir();
    const heavyPackagePath = join(dir, "heavy-package.ts");
    writeFileSync(heavyPackagePath, `throw new Error("Cannot load this in a Node.js context");`, "utf-8");
    const configPath = join(dir, "stack.config.ts");
    writeFileSync(configPath, `
      import "${heavyPackagePath}";
      export const config = {};
    `, "utf-8");

    const { readConfigFile } = await import("./config-file");

    await expect(readConfigFile(configPath)).rejects.toThrow(
      `Failed to load config file ${configPath}. If your config imports a value (e.g. defineHexclaveConfig) from a framework package such as "@hexclave/next", import it from that package's lightweight "/config" entrypoint instead`
    );
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
    // Pin the SDK package the rendered import line points at, so the snapshot
    // doesn't depend on which @hexclave/* package the surrounding workspace
    // (apps/dashboard) happens to depend on.
    writeFileSync(join(createTempDir(), "package.json"), JSON.stringify({ dependencies: { "@hexclave/js": "*" } }), "utf-8");
    const { readConfigFile, writeConfigObject } = await import("./config-file");
    const current = await readConfigFile(configPath);

    writeConfigObject(configPath, {
      ...current.config,
      "payments.testMode": true,
    });

    expect(readFileSync(configPath, "utf-8")).toMatchInlineSnapshot(`
      "import type { HexclaveConfig } from "@hexclave/js/config";

      export const config: HexclaveConfig = {
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
