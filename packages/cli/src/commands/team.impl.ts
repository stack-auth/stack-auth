import { confirm, input } from "@inquirer/prompts";
import { KnownErrors } from "@hexclave/shared";
import type { CurrentInternalUser, Team } from "@hexclave/js";
import type { Command } from "commander";
import { getInternalUser } from "../lib/app.js";
import { resolveSessionAuth } from "../lib/auth.js";
import { CliError } from "../lib/errors.js";
import { isNonInteractiveEnv } from "../lib/interactive.js";
import { resolveTeam } from "../lib/resolve-team.js";
import { formatTeamList, formatTeamMembers } from "./team.js";

type TeamOptions = {
  teamId?: string,
};

type ConfirmationOptions = {
  yes?: boolean,
};

function isJson(program: Command): boolean {
  return Boolean(program.opts<{ json?: boolean }>().json);
}

function printResult(program: Command, result: unknown, humanOutput: string): void {
  console.log(isJson(program) ? JSON.stringify(result, null, 2) : humanOutput);
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
  printResult(program, result, formatTeamList(result));
}

function printTeam(program: Command, team: Team, prefix: string): void {
  const result = { id: team.id, displayName: team.displayName };
  printResult(program, result, `${prefix}: ${result.id} (${result.displayName})`);
}

export async function list(program: Command): Promise<void> {
  const user = await getUser();
  printTeams(program, await user.listTeams());
}

export async function create(program: Command, options: { displayName?: string }): Promise<void> {
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
}

export async function listMembers(program: Command, options: TeamOptions): Promise<void> {
  const user = await getUser();
  const selectedTeam = await getTeam(user, options);
  const teamUsers = await withTeamPermissionError("list team members", () => selectedTeam.listUsers());
  const result = teamUsers.map((member) => ({
    id: member.id,
    displayName: member.teamProfile.displayName,
  }));
  printResult(program, result, formatTeamMembers(result));
}

export async function removeMember(
  program: Command,
  options: TeamOptions & { userId: string } & ConfirmationOptions,
): Promise<void> {
  const user = await getUser();
  const selectedTeam = await getTeam(user, options);
  await confirmDestructive(`remove user ${options.userId} from team ${selectedTeam.id}`, options);
  await withTeamPermissionError("remove this team member", () => selectedTeam.removeUser(options.userId));
  printResult(program, { teamId: selectedTeam.id, userId: options.userId }, `Removed team member: ${options.userId}`);
}

export async function invite(program: Command, options: TeamOptions & { email?: string }): Promise<void> {
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
  printResult(program, { teamId: selectedTeam.id, email }, `Invitation sent to ${email}.`);
}

export async function listInvitations(program: Command, options: TeamOptions): Promise<void> {
  const user = await getUser();
  const selectedTeam = await getTeam(user, options);
  const sentInvitations = await withTeamPermissionError("list team invitations", () => selectedTeam.listInvitations());
  const result = sentInvitations.map((invitation) => ({
    id: invitation.id,
    email: invitation.recipientEmail,
    expiresAt: invitation.expiresAt.toISOString(),
  }));
  const humanOutput = result.length === 0
    ? "No invitations found."
    : result.map((invitation) => `${invitation.id}\t${invitation.email ?? "(unknown)"}\t${invitation.expiresAt}`).join("\n");
  printResult(program, result, humanOutput);
}

export async function revokeInvitation(
  program: Command,
  options: TeamOptions & { invitationId: string } & ConfirmationOptions,
): Promise<void> {
  const user = await getUser();
  const selectedTeam = await getTeam(user, options);
  await confirmDestructive(`revoke invitation ${options.invitationId}`, options);
  const invitation = (await withTeamPermissionError("list team invitations", () => selectedTeam.listInvitations()))
    .find((candidate) => candidate.id === options.invitationId);
  if (invitation == null) {
    throw new CliError(`Invitation '${options.invitationId}' was not found for team '${selectedTeam.id}'.`);
  }
  await withTeamPermissionError("revoke this invitation", () => invitation.revoke());
  printResult(program, { teamId: selectedTeam.id, invitationId: options.invitationId }, `Invitation revoked: ${options.invitationId}`);
}

export async function listReceivedInvitations(program: Command): Promise<void> {
  const user = await getUser();
  const receivedInvitations = await user.listTeamInvitations();
  const result = receivedInvitations.map((invitation) => ({
    id: invitation.id,
    teamId: invitation.teamId,
    teamDisplayName: invitation.teamDisplayName,
    email: invitation.recipientEmail,
    expiresAt: invitation.expiresAt.toISOString(),
  }));
  const humanOutput = result.length === 0
    ? "No received invitations found."
    : result.map((invitation) => `${invitation.id}\t${invitation.teamId}\t${invitation.teamDisplayName}\t${invitation.expiresAt}`).join("\n");
  printResult(program, result, humanOutput);
}

export async function acceptInvitation(program: Command, options: { invitationId: string }): Promise<void> {
  const user = await getUser();
  const invitation = (await user.listTeamInvitations())
    .find((candidate) => candidate.id === options.invitationId);
  if (invitation == null) {
    throw new CliError(`Received invitation '${options.invitationId}' was not found.`);
  }
  await invitation.accept();
  printResult(program, { invitationId: options.invitationId, teamId: invitation.teamId }, `Invitation accepted for team: ${invitation.teamId}`);
}

export async function leave(program: Command, options: TeamOptions & ConfirmationOptions): Promise<void> {
  const user = await getUser();
  const selectedTeam = await getTeam(user, options);
  await confirmDestructive(`leave team ${selectedTeam.id}`, options);
  await user.leaveTeam(selectedTeam);
  printResult(program, { teamId: selectedTeam.id }, `Left team: ${selectedTeam.id}`);
}

export async function update(
  program: Command,
  options: TeamOptions & { displayName?: string },
): Promise<void> {
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
  printResult(program, { id: selectedTeam.id, displayName }, `Team updated: ${selectedTeam.id} (${displayName})`);
}

export async function deleteTeam(program: Command, options: TeamOptions & ConfirmationOptions): Promise<void> {
  const user = await getUser();
  const selectedTeam = await getTeam(user, options);
  await confirmDestructive(`delete team ${selectedTeam.id}`, options);
  await withTeamPermissionError("delete team", () => selectedTeam.delete());
  printResult(program, { teamId: selectedTeam.id }, `Team deleted: ${selectedTeam.id}`);
}
