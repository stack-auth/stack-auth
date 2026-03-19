import fs from "fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfigFromFile, writeConfigToFile } from "./local-emulator";

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

  it("writes new config files to the host mount when the mounted parent directory exists", async () => {
    const accessSpy = vi.spyOn(fs, "access")
      .mockRejectedValueOnce(Object.assign(new Error("missing file"), { code: "ENOENT" }))
      .mockResolvedValueOnce(undefined);
    const mkdirSpy = vi.spyOn(fs, "mkdir").mockResolvedValueOnce("/host/Users/foo/project");
    const writeFileSpy = vi.spyOn(fs, "writeFile").mockResolvedValueOnce();

    await writeConfigToFile("/Users/foo/project/stack.config.ts", { auth: { allowLocalhost: true } });

    expect(accessSpy).toHaveBeenNthCalledWith(1, "/host/Users/foo/project/stack.config.ts");
    expect(accessSpy).toHaveBeenNthCalledWith(2, "/host/Users/foo/project");
    expect(mkdirSpy).toHaveBeenCalledWith("/host/Users/foo/project", { recursive: true });
    expect(writeFileSpy).toHaveBeenCalledWith(
      "/host/Users/foo/project/stack.config.ts",
      `export const config = {\n  "auth": {\n    "allowLocalhost": true\n  }\n};\n`,
      "utf-8",
    );
  });
});
