import { describe, expect, it } from "vitest";
import { isTvPresentationPath } from "./routes";

describe("TV presentation route matching", () => {
  it("matches only a project presentation route", () => {
    expect(isTvPresentationPath("/projects/project-a/tv-mode/present/company-pulse")).toBe(true);
    expect(isTvPresentationPath("/projects/project-a/tv-mode/present/company-pulse/")).toBe(true);
    expect(isTvPresentationPath("/projects/project-a/tv-mode")).toBe(false);
    expect(isTvPresentationPath("/tv")).toBe(false);
  });
});
