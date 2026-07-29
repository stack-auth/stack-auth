import { describe, expect, it } from "vitest";
import { vercelProjectNameForService } from "./index";

describe("vercelProjectNameForService", () => {
  it("produces a stable Vercel-compatible name", () => {
    const name = vercelProjectNameForService("Project_ID", "Web/API");
    expect(name).toMatch(/^hxc-project-id-web-api-[0-9a-f]{12}$/);
    expect(name).toBe(vercelProjectNameForService("Project_ID", "Web/API"));
  });

  it("retains a unique identity hash when long names share a truncated prefix", () => {
    const commonPrefix = "service-" + "a".repeat(120);
    const first = vercelProjectNameForService("project", `${commonPrefix}-one`);
    const second = vercelProjectNameForService("project", `${commonPrefix}-two`);
    expect(first).toHaveLength(100);
    expect(second).toHaveLength(100);
    expect(first).not.toBe(second);
  });

  it("distinguishes identifiers that sanitize to the same readable text", () => {
    expect(vercelProjectNameForService("project", "api_one"))
      .not.toBe(vercelProjectNameForService("project", "api-one"));
  });
});
