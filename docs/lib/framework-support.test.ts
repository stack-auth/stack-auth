import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { setupExamples } from "../code-examples/setup";
import { getFrameworksForPlatform } from "./platform-config";

const firstWaveFrameworks = [
  "Next.js",
  "React Router",
  "TanStack Start",
  "Nuxt",
  "SvelteKit",
  "NestJS",
  "Express",
  "Hono",
  "Cloudflare Workers",
] as const;

describe("framework support docs", () => {
  it("registers the first-wave frameworks in the docs platform config", () => {
    expect(getFrameworksForPlatform("JavaScript")).toEqual(
      expect.arrayContaining([...firstWaveFrameworks]),
    );
  });

  it("provides setup guide examples for every first-wave framework", () => {
    const setupSections = [
      "install-package",
      "env-config",
      "stack-config",
      "auth-handlers",
      "test-setup",
      "basic-usage",
    ] as const;

    for (const section of setupSections) {
      const examples = setupExamples.setup[section];
      const frameworks = new Set(examples.map((example) => example.framework));
      for (const framework of firstWaveFrameworks) {
        expect(frameworks.has(framework)).toBe(true);
      }
    }
  });

  it("keeps setup prompts and analytics docs aligned with the support tiers", async () => {
    const [setupInstructions, analyticsDoc] = await Promise.all([
      fs.readFile(new URL("../src/app/api/internal/[transport]/setup-instructions.md", import.meta.url), "utf8"),
      fs.readFile(new URL("../content/docs/(guides)/apps/analytics-custom-events.mdx", import.meta.url), "utf8"),
    ]);

    expect(setupInstructions).toContain("React Router / TanStack Start");
    expect(setupInstructions).not.toContain("only supports Next.js and React");
    expect(analyticsDoc).toContain("First-class");
    expect(analyticsDoc).toContain("Runtime-supported");
  });
});
