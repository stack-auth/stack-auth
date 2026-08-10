import { describe, expect, it } from "vitest";
import { getParentAppId } from "./apps-config";

describe("app hierarchy", () => {
  it("keeps Observability and Warehouse independent from Analytics", () => {
    expect(getParentAppId("observability")).toBeNull();
    expect(getParentAppId("warehouse")).toBeNull();
    expect(getParentAppId("clickmaps")).toBe("analytics");
    expect(getParentAppId("session-replays")).toBe("analytics");
  });
});
