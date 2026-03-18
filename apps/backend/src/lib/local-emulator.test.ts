import { afterEach, describe, expect, it, vi } from "vitest";
import { readConfigFileContentIfExists, readConfigFromFile, writeConfigToFile } from "./local-emulator";

describe("local emulator file bridge", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("reads config files through the host file bridge when configured", async () => {
    vi.stubEnv("STACK_LOCAL_EMULATOR_FILE_BRIDGE_URL", "http://127.0.0.1:8116");
    vi.stubEnv("STACK_LOCAL_EMULATOR_FILE_BRIDGE_TOKEN", "bridge-token");

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({
        exists: true,
        content: "export const config = { auth: { allowLocalhost: true } };\n",
      }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(readConfigFromFile("/Users/tester/example/stack.config.ts")).resolves.toMatchInlineSnapshot(`
      {
        "auth": {
          "allowLocalhost": true,
        },
      }
    `);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/read", "http://127.0.0.1:8116"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "X-Stack-Emulator-Token": "bridge-token",
        }),
      }),
    );
  });

  it("returns null for missing files when the host file bridge reports they do not exist", async () => {
    vi.stubEnv("STACK_LOCAL_EMULATOR_FILE_BRIDGE_URL", "http://127.0.0.1:8116");
    vi.stubEnv("STACK_LOCAL_EMULATOR_FILE_BRIDGE_TOKEN", "bridge-token");

    vi.stubGlobal("fetch", vi.fn(async () => {
      return new Response(JSON.stringify({ exists: false }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }));

    await expect(readConfigFileContentIfExists("/Users/tester/example/missing-stack.config.ts")).resolves.toBeNull();
  });

  it("writes config files through the host file bridge when configured", async () => {
    vi.stubEnv("STACK_LOCAL_EMULATOR_FILE_BRIDGE_URL", "http://127.0.0.1:8116");
    vi.stubEnv("STACK_LOCAL_EMULATOR_FILE_BRIDGE_TOKEN", "bridge-token");

    const fetchMock = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await writeConfigToFile("/Users/tester/example/stack.config.ts", { teams: { enabled: true } });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("/write", "http://127.0.0.1:8116"),
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          path: "/Users/tester/example/stack.config.ts",
          content: `export const config = ${JSON.stringify({ teams: { enabled: true } }, null, 2)};\n`,
        }),
      }),
    );
  });
});
