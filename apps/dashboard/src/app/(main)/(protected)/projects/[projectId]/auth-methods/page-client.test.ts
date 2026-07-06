import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

describe("auth methods live preview", () => {
  it("keeps the hosted auth preview interactive", () => {
    const testDir = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(testDir, "page-client.tsx"), "utf-8");

    const previewBlockMatch = source.match(/(<[^>]*HostedAuthMethodPreview[\s\S]*?\/>[\s\S]{0,300})/);
    expect(previewBlockMatch).not.toBeNull();
    const previewBlock = previewBlockMatch![1];

    expect(previewBlock).not.toContain("pointer-events-none");
    expect(previewBlock).not.toContain("inert");
    expect(previewBlock).not.toContain("bg-transparent");
  });
});
