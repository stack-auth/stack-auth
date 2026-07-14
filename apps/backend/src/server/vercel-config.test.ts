import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Vercel deployment configuration", () => {
  it("uses native Elysia routing and inherits the project function duration", async () => {
    const [vercelJson, entry] = await Promise.all([
      readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
      readFile(new URL("../index.ts", import.meta.url), "utf8"),
    ]);

    const config = JSON.parse(vercelJson);
    expect(config.framework).toBe("elysia");
    expect(config).not.toHaveProperty("rewrites");
    expect(config).not.toHaveProperty("functions");
    expect(entry).toContain('import "elysia"');
    expect(entry).toContain('from "../dist/vercel.mjs"');
    expect(entry).not.toContain("maxDuration");
  });
});
