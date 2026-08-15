import { describe, expect, it } from "vitest";
import { getTvDisplayRequestHeaders } from "./page-client";

describe("independent TV display requests", () => {
  it("does not advertise JSON for a bodyless pairing or refresh request", () => {
    const headers = getTvDisplayRequestHeaders({ method: "POST" });
    expect(headers.has("content-type")).toBe(false);
  });

  it("advertises JSON when a request has a JSON body", () => {
    const headers = getTvDisplayRequestHeaders({
      method: "POST",
      body: JSON.stringify({ deviceSecret: "secret" }),
    });
    expect(headers.get("content-type")).toBe("application/json");
  });
});
