import { describe, expect, it } from "vitest";
import { getSetupFramework, setupFrameworkGroups } from "./setup-frameworks";

describe("setup-frameworks", () => {
  it("maps first-wave frameworks to the expected package families", () => {
    expect(getSetupFramework("nextjs").packageName).toBe("@stackframe/stack");
    expect(getSetupFramework("react-router").packageName).toBe("@stackframe/react");
    expect(getSetupFramework("tanstack-start").packageName).toBe("@stackframe/react");
    expect(getSetupFramework("nuxt").packageName).toBe("@stackframe/js");
    expect(getSetupFramework("sveltekit").packageName).toBe("@stackframe/js");
    expect(getSetupFramework("nestjs").packageName).toBe("@stackframe/js");
    expect(getSetupFramework("express").packageName).toBe("@stackframe/js");
    expect(getSetupFramework("hono").packageName).toBe("@stackframe/js");
    expect(getSetupFramework("cloudflare-workers").packageName).toBe("@stackframe/js");
  });

  it("uses framework env snippets only where the convention is stable", () => {
    expect(getSetupFramework("nextjs").envPreset).toBe("nextjs");
    expect(getSetupFramework("react-router").envPreset).toBe("vite");
    expect(getSetupFramework("tanstack-start").envPreset).toBe("vite");
    expect(getSetupFramework("nuxt").envPreset).toBe("nuxt");
    expect(getSetupFramework("sveltekit").envPreset).toBe("sveltekit");
    expect(getSetupFramework("nestjs").envPreset).toBeNull();
    expect(getSetupFramework("express").envPreset).toBeNull();
    expect(getSetupFramework("hono").envPreset).toBeNull();
    expect(getSetupFramework("cloudflare-workers").envPreset).toBeNull();
  });

  it("keeps the grouped selector aligned with the support tiers", () => {
    expect(setupFrameworkGroups).toMatchInlineSnapshot(`
      [
        {
          "frameworkIds": [
            "nextjs",
            "react-router",
            "tanstack-start",
          ],
          "id": "react-apps",
          "name": "React apps",
        },
        {
          "frameworkIds": [
            "nuxt",
            "sveltekit",
          ],
          "id": "full-stack-js",
          "name": "Full-stack JS",
        },
        {
          "frameworkIds": [
            "nestjs",
            "express",
            "hono",
            "cloudflare-workers",
          ],
          "id": "server-edge",
          "name": "Server / edge",
        },
      ]
    `);
  });
});
