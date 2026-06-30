import { describe, expect, it } from "vitest";
import { formatProjectList, resolveProjectListSources, type ProjectListEntry } from "./project.js";

describe("resolveProjectListSources", () => {
  it("defaults to both sources when no flag is passed", () => {
    expect(resolveProjectListSources()).toMatchInlineSnapshot(`
      {
        "cloud": true,
        "local": true,
      }
    `);
  });

  it("returns cloud-only when --cloud is passed", () => {
    expect(resolveProjectListSources({ cloud: true })).toMatchInlineSnapshot(`
      {
        "cloud": true,
        "local": false,
      }
    `);
  });

  it("returns local-only when --local is passed", () => {
    expect(resolveProjectListSources({ local: true })).toMatchInlineSnapshot(`
      {
        "cloud": false,
        "local": true,
      }
    `);
  });

  it("rejects both flags", () => {
    expect(() => resolveProjectListSources({ cloud: true, local: true })).toThrow(
      /not both/,
    );
  });
});

describe("formatProjectList", () => {
  it("returns the empty-list sentinel when no projects are passed", () => {
    expect(formatProjectList([])).toBe("No projects found.");
  });

  it("formats each project as `<id>\\t<name>\\t[<target>]`", () => {
    const projects: ProjectListEntry[] = [
      { id: "p1", displayName: "Cloud A", target: "cloud" },
      { id: "p2", displayName: "Local B", target: "local" },
    ];
    expect(formatProjectList(projects)).toBe("p1\tCloud A\t[cloud]\np2\tLocal B\t[local]");
  });
});
