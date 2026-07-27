import { describe, expect, it } from "vitest";
import { getTvSnapshotPath } from "./hexclave-app-internals";

describe("TV snapshot admin path", () => {
  it("keeps the profile as a URL-encoded path resource", () => {
    expect(getTvSnapshotPath("office / north")).toBe(
      "/internal/tv-mode/profiles/office%20%2F%20north/snapshot",
    );
  });
});
