import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV,
  isLocalEmulatorOnboardingEnabledInConfig,
  readConfigFromFile,
  writeConfigToFile,
  writeShowOnboardingConfigToFile,
} from "./local-emulator";

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

  it("treats show-onboarding config as an empty config override", async () => {
    const content = `export const config = "show-onboarding";\n`;
    vi.stubEnv("STACK_LOCAL_EMULATOR_CONFIG_CONTENT", Buffer.from(content).toString("base64"));

    await expect(readConfigFromFile("/irrelevant/path/stack.config.ts")).resolves.toEqual({});
    await expect(isLocalEmulatorOnboardingEnabledInConfig("/irrelevant/path/stack.config.ts")).resolves.toBe(true);
  });

  it("throws when the config module does not export config", async () => {
    const content = `export default { auth: { allowLocalhost: true } };\n`;
    vi.stubEnv("STACK_LOCAL_EMULATOR_CONFIG_CONTENT", Buffer.from(content).toString("base64"));

    await expect(readConfigFromFile("/irrelevant/path/stack.config.ts")).rejects.toThrow(
      "Invalid config in /irrelevant/path/stack.config.ts. The file must export a 'config' object or \"show-onboarding\"."
    );
  });

  it("reads config files from the host mount when configured", async () => {
    const hostMountRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stack-host-mount-"));
    const absoluteFilePath = "/Users/foo/project/stack.config.ts";
    const mountedFilePath = path.join(hostMountRoot, absoluteFilePath);
    await fs.mkdir(path.dirname(mountedFilePath), { recursive: true });
    await fs.writeFile(mountedFilePath, `export const config = { auth: { allowLocalhost: true } };\n`, "utf-8");

    vi.stubEnv(LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV, hostMountRoot);

    await expect(readConfigFromFile(absoluteFilePath)).resolves.toMatchInlineSnapshot(`
      {
        "auth": {
          "allowLocalhost": true,
        },
      }
    `);
  });

  it("writes new config files to the host mount when the mounted parent directory exists", async () => {
    const hostMountRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stack-host-mount-"));
    const absoluteFilePath = "/Users/foo/project/stack.config.ts";
    const mountedParentPath = path.join(hostMountRoot, "/Users/foo/project");
    const mountedFilePath = path.join(hostMountRoot, absoluteFilePath);
    await fs.mkdir(mountedParentPath, { recursive: true });

    vi.stubEnv(LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV, hostMountRoot);

    await writeConfigToFile(absoluteFilePath, { auth: { allowLocalhost: true } });

    await expect(fs.readFile(mountedFilePath, "utf-8")).resolves.toBe(
      `import type { StackConfig } from "@stackframe/js";\n\nexport const config: StackConfig = {\n  "auth": {\n    "allowLocalhost": true\n  }\n};\n`
    );
  });

  it("writes show-onboarding config files to the host mount", async () => {
    const hostMountRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stack-host-mount-"));
    const absoluteFilePath = "/Users/foo/project/stack.config.ts";
    const mountedParentPath = path.join(hostMountRoot, "/Users/foo/project");
    const mountedFilePath = path.join(hostMountRoot, absoluteFilePath);
    await fs.mkdir(mountedParentPath, { recursive: true });

    vi.stubEnv(LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV, hostMountRoot);

    await writeShowOnboardingConfigToFile(absoluteFilePath);

    await expect(fs.readFile(mountedFilePath, "utf-8")).resolves.toBe(
      `import type { StackConfig } from "@stackframe/js";\n\nexport const config: StackConfig = "show-onboarding";\n`
    );
  });

  it("supports non-ts config filenames by evaluating them as TypeScript", async () => {
    const hostMountRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stack-host-mount-"));
    const absoluteFilePath = "/Users/foo/project/test-config.untracked";
    const mountedParentPath = path.join(hostMountRoot, "/Users/foo/project");
    const mountedFilePath = path.join(hostMountRoot, absoluteFilePath);
    await fs.mkdir(mountedParentPath, { recursive: true });

    vi.stubEnv(LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV, hostMountRoot);

    await writeConfigToFile(absoluteFilePath, { auth: { allowLocalhost: true } });

    await expect(readConfigFromFile(absoluteFilePath)).resolves.toEqual({
      auth: {
        allowLocalhost: true,
      },
    });
    await expect(fs.readFile(mountedFilePath, "utf-8")).resolves.toContain(`import type { StackConfig }`);
  });

  it("fails loudly when the QEMU host mount root is configured but unavailable", async () => {
    const hostMountRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stack-host-mount-"));
    vi.stubEnv(LOCAL_EMULATOR_HOST_MOUNT_ROOT_ENV, hostMountRoot);

    await expect(writeConfigToFile("/Users/foo/project/stack.config.ts", { auth: { allowLocalhost: true } })).rejects.toThrow(
      `Local emulator host mount root ${hostMountRoot} is configured`
    );
  });
});
