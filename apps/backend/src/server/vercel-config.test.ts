import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Vercel function durations", () => {
  it("preserves the route-specific limits from the Next.js deployment", async () => {
    const [vercelJson, applyEntry, commitEntry] = await Promise.all([
      readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
      readFile(new URL("../../api/config-github-apply.ts", import.meta.url), "utf8"),
      readFile(new URL("../../api/config-github-commit.ts", import.meta.url), "utf8"),
    ]);

    expect(JSON.parse(vercelJson)).toMatchObject({
      rewrites: [
        {
          source: "/api/:version/internal/config/github/apply",
          destination: "/api/config-github-apply",
        },
        {
          source: "/api/:version/internal/config/github/commit",
          destination: "/api/config-github-commit",
        },
        {
          source: "/(.*)",
          destination: "/api",
        },
      ],
    });
    expect(applyEntry).toContain("maxDuration: 800");
    expect(commitEntry).toContain("maxDuration: 120");
  });
});
