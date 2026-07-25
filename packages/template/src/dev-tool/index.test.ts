import { afterEach, describe, expect, it, vi } from "vitest";
import { StackClientApp } from "../lib/hexclave-app";
import { createDevTool } from "./dev-tool-core";
import { mountDevTool } from ".";

vi.mock("./dev-tool-core", () => ({
  createDevTool: vi.fn(() => () => {}),
}));

describe("dev tool visibility", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows for a development environment project in a production-hosted app", async () => {
    const app = new StackClientApp({
      baseUrl: "https://api.example.com",
      projectId: "00000000-0000-4000-8000-000000000000",
      publishableClientKey: "stack-pk-test",
      tokenStore: "memory",
      redirectMethod: "none",
      devTool: false,
    });
    const getProject = vi.fn(async () => ({
      isDevelopmentEnvironment: true,
    }));
    Reflect.set(app, "getProject", getProject);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubGlobal("window", {
      location: {
        href: "https://example.com",
      },
    });
    vi.stubGlobal("document", {
      body: {
        appendChild: () => {},
      },
      createElement: () => ({}),
    });
    vi.stubGlobal("localStorage", {
      getItem: () => null,
    });

    mountDevTool(app);

    await vi.waitFor(() => {
      expect(getProject).toHaveBeenCalledOnce();
      expect(createDevTool).toHaveBeenCalledOnce();
    });
  });
});
