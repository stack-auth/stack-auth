import { input } from "@inquirer/prompts";
import type { CurrentInternalUser } from "@stackframe/js";
import { CliError } from "./errors.js";
import { isNonInteractiveEnv } from "./interactive.js";

type CreateProjectOptions = {
  displayName?: string,
  defaultDisplayName?: string,
};

export async function createProjectInteractively(
  user: CurrentInternalUser,
  opts: CreateProjectOptions = {},
) {
  let displayName = opts.displayName;
  if (!displayName) {
    if (isNonInteractiveEnv()) {
      throw new CliError("--display-name is required in non-interactive environments (CI).");
    }
    displayName = await input({
      message: "Project display name:",
      default: opts.defaultDisplayName,
      validate: (v) => v.trim().length > 0 || "Display name cannot be empty.",
    });
  }

  const teams = await user.listTeams();
  if (teams.length === 0) {
    throw new CliError("No teams found on your account. Create a team at app.stack-auth.com first.");
  }

  return await user.createProject({
    displayName: displayName.trim(),
    teamId: teams[0].id,
  });
}
