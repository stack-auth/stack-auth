import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

// Lets each AI-path test inject what the (otherwise network-backed) agent does
// to the files on disk, so we can exercise the orchestration and validation
// around `updateConfigObject` without calling a real model.
let mockAgentImpl: ((options: { prompt: string, cwd: string }) => void | Promise<void>) | null = null;

vi.mock("server-only", () => ({}));
vi.mock("./config-update-agent", () => ({
  runConfigUpdateAgent: async (options: { prompt: string, cwd: string }) => {
    if (mockAgentImpl == null) {
      throw new Error("runConfigUpdateAgent was called but no mock implementation was set for this test.");
    }
    await mockAgentImpl(options);
  },
}));

let tempDir: string | undefined;

function writeTempFile(name: string, content: string): string {
  tempDir ??= mkdtempSync(join(process.cwd(), ".stack-rde-config-test-"));
  const filePath = join(tempDir, name);
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function writeTempConfig(content: string): string {
  return writeTempFile("stack.config.ts", content);
}

afterEach(() => {
  vi.resetModules();
  mockAgentImpl = null;
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

  it("applies updates to a plain static config deterministically, without the agent", async () => {
    const configPath = writeTempConfig(`
      export const config = {
        auth: {
          allowSignUp: false,
        },
      };
    `);
    const { readConfigFile, updateConfigObject } = await import("./config-file");

    // No mock impl is set: if this path tried to invoke the agent, the mock
    // would throw. A plain static literal must take the deterministic fast path.
    await updateConfigObject(configPath, {
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

  it("updates the externally-referenced file instead of inlining or overwriting the config", async () => {
    const templatePath = writeTempFile("welcome-email.tsx", "export default <div>Old email</div>;\n");
    const configSource = `import welcomeEmail from "./welcome-email.tsx" with { type: "text" };\n\nexport const config = {\n  emails: { templates: { welcome: welcomeEmail } },\n};\n`;
    const configPath = writeTempConfig(configSource);

    const { updateConfigObject } = await import("./config-file");

    // Simulate the agent: write the new value into the referenced file and leave
    // the config file untouched.
    mockAgentImpl = () => {
      writeFileSync(templatePath, "export default <div>New email</div>;\n", "utf-8");
    };

    await updateConfigObject(configPath, {
      "emails.templates.welcome": "export default <div>New email</div>;\n",
    });

    // The external file is updated and the config file keeps its import + shape.
    expect(readFileSync(templatePath, "utf-8")).toBe("export default <div>New email</div>;\n");
    expect(readFileSync(configPath, "utf-8")).toBe(configSource);
  });

  it("validates the result semantically when the config is evaluable", async () => {
    const configPath = writeTempConfig(`
      import { defineStackConfig } from "@hexclave/shared/config";
      export const config = defineStackConfig({
        auth: { allowSignUp: true },
      });
    `);
    const { readConfigFile, updateConfigObject } = await import("./config-file");

    mockAgentImpl = () => {
      writeFileSync(configPath, `
        import { defineStackConfig } from "@hexclave/shared/config";
        export const config = defineStackConfig({
          auth: { allowSignUp: false },
        });
      `, "utf-8");
    };

    await updateConfigObject(configPath, { "auth.allowSignUp": false });

    // The defineStackConfig wrapper is preserved and the value is updated.
    expect(readFileSync(configPath, "utf-8")).toContain("defineStackConfig");
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

  it("throws when the agent produces a config that does not match the requested update", async () => {
    const configPath = writeTempConfig(`
      import { defineStackConfig } from "@hexclave/shared/config";
      export const config = defineStackConfig({
        auth: { allowSignUp: true },
      });
    `);
    const { updateConfigObject } = await import("./config-file");

    // The agent writes the wrong value (allowSignUp stays true).
    mockAgentImpl = () => {
      writeFileSync(configPath, `
        import { defineStackConfig } from "@hexclave/shared/config";
        export const config = defineStackConfig({
          auth: { allowSignUp: true },
        });
      `, "utf-8");
    };

    await expect(updateConfigObject(configPath, { "auth.allowSignUp": false }))
      .rejects.toThrow(/validation failed/);
  });
});
