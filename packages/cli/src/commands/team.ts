import { confirm, input } from "@inquirer/prompts";
import { KnownErrors } from "@hexclave/shared";
import type { CurrentInternalUser, Team } from "@hexclave/js";
import { Command } from "commander";
import { getInternalUser } from "../lib/app.js";
import { resolveSessionAuth } from "../lib/auth.js";
import { CliError } from "../lib/errors.js";
import { isNonInteractiveEnv } from "../lib/interactive.js";
import { resolveTeam } from "../lib/resolve-team.js";

type TeamOptions = {
  teamId?: string,
};

type ConfirmationOptions = {
  yes?: boolean,
};

function isJson(program: Command): boolean {
  return Boolean((program.opts() as { json?: boolean }).json);
}

async function withTeamPermissionError<T>(operation: string, callback: () => Promise<T>): Promise<T> {
  try {
    return await callback();
  } catch (error) {
    if (KnownErrors.TeamPermissionRequired.isInstance(error)) {
      throw new CliError(`Cannot ${operation}. You do not have the required permission for this team.`);
    }
    throw error;
  }
}

async function getTeam(user: CurrentInternalUser, options: TeamOptions): Promise<Team> {
  return await resolveTeam(await user.listTeams(), options);
}

async function getUser(): Promise<CurrentInternalUser> {
  return await getInternalUser(resolveSessionAuth());
}

async function confirmDestructive(action: string, options: ConfirmationOptions): Promise<void> {
  if (options.yes) return;
  if (isNonInteractiveEnv()) {
    throw new CliError(`--yes is required to ${action} in non-interactive environments (CI).`);
  }
  const shouldContinue = await confirm({
    message: `Are you sure you want to ${action}?`,
    default: false,
  });
  if (!shouldContinue) {
    throw new CliError("Aborted.");
  }
}

function printTeams(program: Command, teams: Team[]): void {
  const result = teams.map((team) => ({ id: team.id, displayName: team.displayName }));
  if (isJson(program)) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(formatTeamList(result));
  }
}

export function formatTeamList(teams: Array<{ id: string, displayName: string }>): string {
  if (teams.length === 0) return "No teams found.";
  return teams.map((team) => `${team.id}\t${team.displayName}`).join("\n");
}

export function formatTeamMembers(members: Array<{ id: string, displayName: string | null }>): string {
  if (members.length === 0) return "No team members found.";
  return members.map((member) => `${member.id}\t${member.displayName ?? "(none)"}`).join("\n");
}

function printTeam(program: Command, team: Team, prefix: string): void {
  const result = { id: team.id, displayName: team.displayName };
  if (isJson(program)) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`${prefix}: ${result.id} (${result.displayName})`);
  }
}

export function registerTeamCommand(program: Command) {
  const team = program
    .command("team")
    .description("Manage teams");

  team
    .command("list")
    .description("List your teams")
    .action(async () => {
      const user = await getUser();
      printTeams(program, await user.listTeams());
    });

  team
    .command("create")
    .description("Create a team")
    .option("--display-name <name>", "Team display name")
    .action(async (options: { displayName?: string }) => {
      let displayName = options.displayName?.trim();
      if (!displayName) {
        if (isNonInteractiveEnv()) {
          throw new CliError("--display-name is required in non-interactive environments (CI).");
        }
        displayName = (await input({
          message: "Team display name:",
          validate: (value) => value.trim().length > 0 || "Display name cannot be empty.",
        })).trim();
      }

      const user = await getUser();
      const newTeam = await user.createTeam({ displayName });
      printTeam(program, newTeam, "Team created");
    });

  const members = team
    .command("members")
    .description("List members of a team")
    .option("--team-id <id>", "Team ID");

  members.action(async (options: TeamOptions) => {
    const user = await getUser();
    const selectedTeam = await getTeam(user, options);
    const teamUsers = await withTeamPermissionError("list team members", () => selectedTeam.listUsers());
    const result = teamUsers.map((member) => ({
      id: member.id,
      displayName: member.teamProfile.displayName,
    }));
    if (isJson(program)) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(formatTeamMembers(result));
    }
  });

  members
    .command("remove")
    .description("Remove a member from a team")
    .option("--team-id <id>", "Team ID")
    .requiredOption("--user-id <id>", "User ID to remove")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (options: TeamOptions & { userId: string } & ConfirmationOptions) => {
      const user = await getUser();
      const selectedTeam = await getTeam(user, options);
      await confirmDestructive(`remove user ${options.userId} from team ${selectedTeam.id}`, options);
      await withTeamPermissionError("remove this team member", () => selectedTeam.removeUser(options.userId));
      if (isJson(program)) {
        console.log(JSON.stringify({ teamId: selectedTeam.id, userId: options.userId }, null, 2));
      } else {
        console.log(`Removed team member: ${options.userId}`);
      }
    });

  team
    .command("invite")
    .description("Invite a user to a team")
    .option("--team-id <id>", "Team ID")
    .option("--email <email>", "Email address to invite")
    .action(async (options: TeamOptions & { email?: string }) => {
      const user = await getUser();
      const selectedTeam = await getTeam(user, options);
      let email = options.email?.trim();
      if (!email) {
        if (isNonInteractiveEnv()) {
          throw new CliError("--email is required in non-interactive environments (CI).");
        }
        email = (await input({
          message: "Email address:",
          validate: (value) => value.trim().length > 0 || "Email address cannot be empty.",
        })).trim();
      }
      await withTeamPermissionError("invite this user", () => selectedTeam.inviteUser({ email }));
      if (isJson(program)) {
        console.log(JSON.stringify({ teamId: selectedTeam.id, email }, null, 2));
      } else {
        console.log(`Invitation sent to ${email}.`);
      }
    });

  const invitations = team
    .command("invitations")
    .description("Manage team invitations")
    .option("--team-id <id>", "Team ID");

  invitations.action(async (options: TeamOptions) => {
    const user = await getUser();
    const selectedTeam = await getTeam(user, options);
    const sentInvitations = await withTeamPermissionError("list team invitations", () => selectedTeam.listInvitations());
    const result = sentInvitations.map((invitation) => ({
      id: invitation.id,
      email: invitation.recipientEmail,
      expiresAt: invitation.expiresAt.toISOString(),
    }));
    if (isJson(program)) {
      console.log(JSON.stringify(result, null, 2));
    } else if (result.length === 0) {
      console.log("No invitations found.");
    } else {
      console.log(result.map((invitation) => `${invitation.id}\t${invitation.email ?? "(unknown)"}\t${invitation.expiresAt}`).join("\n"));
    }
  });

  invitations
    .command("revoke")
    .description("Revoke a team invitation")
    .option("--team-id <id>", "Team ID")
    .requiredOption("--invitation-id <id>", "Invitation ID")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (options: TeamOptions & { invitationId: string } & ConfirmationOptions) => {
      const user = await getUser();
      const selectedTeam = await getTeam(user, options);
      await confirmDestructive(`revoke invitation ${options.invitationId}`, options);
      const invitation = (await withTeamPermissionError("list team invitations", () => selectedTeam.listInvitations()))
        .find((candidate) => candidate.id === options.invitationId);
      if (invitation == null) {
        throw new CliError(`Invitation '${options.invitationId}' was not found for team '${selectedTeam.id}'.`);
      }
      await withTeamPermissionError("revoke this invitation", () => invitation.revoke());
      if (isJson(program)) {
        console.log(JSON.stringify({ teamId: selectedTeam.id, invitationId: options.invitationId }, null, 2));
      } else {
        console.log(`Invitation revoked: ${options.invitationId}`);
      }
    });

  invitations
    .command("received")
    .description("List invitations received by the current user")
    .action(async () => {
      const user = await getUser();
      const receivedInvitations = await user.listTeamInvitations();
      const result = receivedInvitations.map((invitation) => ({
        id: invitation.id,
        teamId: invitation.teamId,
        teamDisplayName: invitation.teamDisplayName,
        email: invitation.recipientEmail,
        expiresAt: invitation.expiresAt.toISOString(),
      }));
      if (isJson(program)) {
        console.log(JSON.stringify(result, null, 2));
      } else if (result.length === 0) {
        console.log("No received invitations found.");
      } else {
        console.log(result.map((invitation) => `${invitation.id}\t${invitation.teamId}\t${invitation.teamDisplayName}\t${invitation.expiresAt}`).join("\n"));
      }
    });

  invitations
    .command("accept")
    .description("Accept an invitation received by the current user")
    .requiredOption("--invitation-id <id>", "Invitation ID")
    .action(async (options: { invitationId: string }) => {
      const user = await getUser();
      const invitation = (await user.listTeamInvitations())
        .find((candidate) => candidate.id === options.invitationId);
      if (invitation == null) {
        throw new CliError(`Received invitation '${options.invitationId}' was not found.`);
      }
      await invitation.accept();
      if (isJson(program)) {
        console.log(JSON.stringify({ invitationId: options.invitationId, teamId: invitation.teamId }, null, 2));
      } else {
        console.log(`Invitation accepted for team: ${invitation.teamId}`);
      }
    });

  team
    .command("leave")
    .description("Leave a team")
    .option("--team-id <id>", "Team ID")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (options: TeamOptions & ConfirmationOptions) => {
      const user = await getUser();
      const selectedTeam = await getTeam(user, options);
      await confirmDestructive(`leave team ${selectedTeam.id}`, options);
      await user.leaveTeam(selectedTeam);
      if (isJson(program)) {
        console.log(JSON.stringify({ teamId: selectedTeam.id }, null, 2));
      } else {
        console.log(`Left team: ${selectedTeam.id}`);
      }
    });

  team
    .command("update")
    .description("Update a team")
    .option("--team-id <id>", "Team ID")
    .option("--display-name <name>", "New team display name")
    .action(async (options: TeamOptions & { displayName?: string }) => {
      const user = await getUser();
      const selectedTeam = await getTeam(user, options);
      let displayName = options.displayName?.trim();
      if (!displayName) {
        if (isNonInteractiveEnv()) {
          throw new CliError("--display-name is required in non-interactive environments (CI).");
        }
        displayName = (await input({
          message: "New team display name:",
          default: selectedTeam.displayName,
          validate: (value) => value.trim().length > 0 || "Display name cannot be empty.",
        })).trim();
      }
      await withTeamPermissionError("update this team", () => selectedTeam.update({ displayName }));
      if (isJson(program)) {
        console.log(JSON.stringify({ id: selectedTeam.id, displayName }, null, 2));
      } else {
        console.log(`Team updated: ${selectedTeam.id} (${displayName})`);
      }
    });

  team
    .command("delete")
    .description("Delete a team")
    .option("--team-id <id>", "Team ID")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (options: TeamOptions & ConfirmationOptions) => {
      const user = await getUser();
      const selectedTeam = await getTeam(user, options);
      await confirmDestructive(`delete team ${selectedTeam.id}`, options);
      await withTeamPermissionError("delete this team", () => selectedTeam.delete());
      if (isJson(program)) {
        console.log(JSON.stringify({ teamId: selectedTeam.id }, null, 2));
      } else {
        console.log(`Team deleted: ${selectedTeam.id}`);
      }
    });
}
