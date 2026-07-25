import { describe, expect, it } from "vitest";
import { formatTeamList, formatTeamMembers } from "./team.js";

describe("formatTeamList", () => {
  it("formats teams as tab-separated rows", () => {
    expect(formatTeamList([
      { id: "team-1", displayName: "Acme" },
      { id: "team-2", displayName: "Beta" },
    ])).toMatchInlineSnapshot(`"team-1\tAcme\nteam-2\tBeta"`);
  });

  it("returns an empty-list sentinel", () => {
    expect(formatTeamList([])).toMatchInlineSnapshot(`"No teams found."`);
  });
});

describe("formatTeamMembers", () => {
  it("uses a placeholder for missing member display names", () => {
    expect(formatTeamMembers([{ id: "user-1", displayName: null }])).toMatchInlineSnapshot(`"user-1\t(none)"`);
  });

  it("returns an empty-list sentinel", () => {
    expect(formatTeamMembers([])).toMatchInlineSnapshot(`"No team members found."`);
  });
});
