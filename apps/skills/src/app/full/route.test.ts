import { describe, expect, it } from "vitest";

import { GET, HEAD, OPTIONS } from "./route";

describe("skill-site full route", () => {
  it("serves the full skill documentation as markdown", async () => {
    const response = GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    await expect(response.text()).resolves.toContain("# Hexclave");
  });

  it("supports HEAD and CORS preflight requests", () => {
    expect(HEAD().status).toBe(200);

    const optionsResponse = OPTIONS();
    expect(optionsResponse.status).toBe(200);
    expect(optionsResponse.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
