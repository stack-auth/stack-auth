import { afterEach, describe, expect, it } from "vitest";
import { CliError } from "./errors.js";
import { resolveTeam } from "./resolve-team.js";

function makeTeam(id: string, displayName: string) {
  return { id, displayName };
}

const savedCi = process.env.CI;
const savedGithubActions = process.env.GITHUB_ACTIONS;
const savedNoninteractive = process.env.NONINTERACTIVE;

afterEach(() => {
  if (savedCi === undefined) delete process.env.CI;
  else process.env.CI = savedCi;
  if (savedGithubActions === undefined) delete process.env.GITHUB_ACTIONS;
  else process.env.GITHUB_ACTIONS = savedGithubActions;
  if (savedNoninteractive === undefined) delete process.env.NONINTERACTIVE;
  else process.env.NONINTERACTIVE = savedNoninteractive;
});

describe("resolveTeam", () => {
  it("returns the explicitly requested team id", async () => {
    const teams = [makeTeam("team-1", "Acme"), makeTeam("team-2", "Beta")];

    await expect(resolveTeam(teams, { teamId: "team-2" })).resolves.toBe(teams[1]);
  });

  it("throws when an explicit team id does not exist", async () => {
    const teams = [makeTeam("team-1", "Acme")];

    await expect(resolveTeam(teams, { teamId: "missing-team" })).rejects.toSatisfy((error: unknown) => (
      error instanceof CliError && error.message === "Team 'missing-team' was not found on your account."
    ));
  });

  it("auto-picks the only team without prompting", async () => {
    const team = makeTeam("team-1", "Acme");

    await expect(resolveTeam([team])).resolves.toBe(team);
  });

  it("rejects multi-team resolution in non-interactive environments", async () => {
    process.env.CI = "1";

    await expect(resolveTeam([makeTeam("team-1", "Acme"), makeTeam("team-2", "Beta")])).rejects.toSatisfy((error: unknown) => (
      error instanceof CliError && error.message === "--team-id is required in non-interactive environments (CI)."
    ));
  });

  it("rejects zero-team resolution in non-interactive environments", async () => {
    process.env.CI = "1";

    await expect(resolveTeam([], { createTeam: async () => makeTeam("team-1", "Acme") })).rejects.toSatisfy((error: unknown) => (
      error instanceof CliError && error.message === "No teams found. Run `hexclave team create` first, or pass --team-id."
    ));
  });
});
