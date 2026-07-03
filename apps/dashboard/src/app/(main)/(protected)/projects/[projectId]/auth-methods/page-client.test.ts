import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

describe("auth methods live preview", () => {
  it("keeps the hosted auth preview interactive", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(testDir, "page-client.tsx"), "utf-8");

    expect(source).not.toContain("pointer-events-none");
    expect(source).not.toContain("inert>");
    expect(source).not.toContain("bg-transparent z-10");
  });
});
