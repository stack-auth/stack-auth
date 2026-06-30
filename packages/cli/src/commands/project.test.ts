import { describe, expect, it } from "vitest";
import { formatProjectList, resolveProjectListSources, type ProjectListEntry } from "./project.js";

describe("resolveProjectListSources", () => {
  it("defaults to cloud projects when no flag is passed", () => {
    expect(resolveProjectListSources({})).toEqual({ cloud: true, dev: false });
  });

  it("filters to cloud-only when --cloud is set", () => {
    expect(resolveProjectListSources({ cloud: true })).toEqual({ cloud: true, dev: false });
  });
});

describe("formatProjectList", () => {
  it("returns the empty-list sentinel when no projects are passed", () => {
    expect(formatProjectList([])).toBe("No projects found.");
  });

  it("formats each project as `<id>\\t<name>\\t[<target>]`", () => {
    const projects: ProjectListEntry[] = [
      { id: "p1", displayName: "Cloud A", target: "cloud" },
    ];
    expect(formatProjectList(projects)).toBe("p1\tCloud A\t[cloud]");
  });
});
