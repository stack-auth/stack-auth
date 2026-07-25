import { input, select } from "@inquirer/prompts";
import type { Team } from "@hexclave/js";
import { CliError } from "./errors.js";
import { isNonInteractiveEnv } from "./interactive.js";

export type ResolveTeamOptions = {
  teamId?: string,
  createTeam?: (displayName: string) => Promise<Team>,
};

export async function resolveTeam(teams: Team[], options: ResolveTeamOptions = {}): Promise<Team> {
  const teamId = options.teamId?.trim();
  if (teamId) {
    const team = teams.find((candidate) => candidate.id === teamId);
    if (team == null) {
      throw new CliError(`Team '${teamId}' was not found on your account.`);
    }
    return team;
  }

  if (teams.length === 0) {
    if (options.createTeam != null) {
      if (isNonInteractiveEnv()) {
        throw new CliError("No teams found. Run `hexclave team create` first, or pass --team-id.");
      }
      const displayName = (await input({
        message: "Team display name:",
        validate: (value) => value.trim().length > 0 || "Display name cannot be empty.",
      })).trim();
      return await options.createTeam(displayName);
    }
    throw new CliError("No teams found. Run `hexclave team create` first.");
  }

  if (teams.length === 1) {
    return teams[0];
  }

  if (isNonInteractiveEnv()) {
    throw new CliError("--team-id is required in non-interactive environments (CI).");
  }

  const selectedTeamId = await select({
    message: "Choose a team:",
    choices: teams.map((team) => ({
      name: `${team.displayName || "(unnamed)"} (${team.id})`,
      value: team.id,
    })),
  });
  const selectedTeam = teams.find((team) => team.id === selectedTeamId);
  if (selectedTeam == null) {
    throw new CliError("The selected team was not found.");
  }
  return selectedTeam;
}
