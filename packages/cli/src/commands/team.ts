import { Command } from "commander";

type TeamOptions = {
  teamId?: string,
};

type ConfirmationOptions = {
  yes?: boolean,
};

export function formatTeamList(teams: Array<{ id: string, displayName: string }>): string {
  if (teams.length === 0) return "No teams found.";
  return teams.map((team) => `${team.id}\t${team.displayName}`).join("\n");
}

export function formatTeamMembers(members: Array<{ id: string, displayName: string | null }>): string {
  if (members.length === 0) return "No team members found.";
  return members.map((member) => `${member.id}\t${member.displayName ?? "(none)"}`).join("\n");
}

export function registerTeamCommand(program: Command) {
  const team = program
    .command("team")
    .description("Manage teams");

  team
    .command("list")
    .description("List your teams")
    .action(async () => {
      const impl = await import("./team.impl.js");
      await impl.list(program);
    });

  team
    .command("create")
    .description("Create a team")
    .option("--display-name <name>", "Team display name")
    .action(async (options: { displayName?: string }) => {
      const impl = await import("./team.impl.js");
      await impl.create(program, options);
    });

  const members = team
    .command("members")
    .description("Manage team members");

  members
    .command("list")
    .description("List members of a team")
    .option("--team-id <id>", "Team ID")
    .action(async (options: TeamOptions) => {
      const impl = await import("./team.impl.js");
      await impl.listMembers(program, options);
    });

  members
    .command("remove")
    .description("Remove a member from a team")
    .option("--team-id <id>", "Team ID")
    .requiredOption("--user-id <id>", "User ID to remove")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (options: TeamOptions & { userId: string } & ConfirmationOptions) => {
      const impl = await import("./team.impl.js");
      await impl.removeMember(program, options);
    });

  team
    .command("invite")
    .description("Invite a user to a team")
    .option("--team-id <id>", "Team ID")
    .option("--email <email>", "Email address to invite")
    .action(async (options: TeamOptions & { email?: string }) => {
      const impl = await import("./team.impl.js");
      await impl.invite(program, options);
    });

  const invitations = team
    .command("invitations")
    .description("Manage team invitations");

  invitations
    .command("list")
    .description("List invitations sent by a team")
    .option("--team-id <id>", "Team ID")
    .action(async (options: TeamOptions) => {
      const impl = await import("./team.impl.js");
      await impl.listInvitations(program, options);
    });

  invitations
    .command("revoke")
    .description("Revoke a team invitation")
    .option("--team-id <id>", "Team ID")
    .requiredOption("--invitation-id <id>", "Invitation ID")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (options: TeamOptions & { invitationId: string } & ConfirmationOptions) => {
      const impl = await import("./team.impl.js");
      await impl.revokeInvitation(program, options);
    });

  invitations
    .command("received")
    .description("List invitations received by the current user")
    .action(async () => {
      const impl = await import("./team.impl.js");
      await impl.listReceivedInvitations(program);
    });

  invitations
    .command("accept")
    .description("Accept an invitation received by the current user")
    .requiredOption("--invitation-id <id>", "Invitation ID")
    .action(async (options: { invitationId: string }) => {
      const impl = await import("./team.impl.js");
      await impl.acceptInvitation(program, options);
    });

  team
    .command("leave")
    .description("Leave a team")
    .option("--team-id <id>", "Team ID")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (options: TeamOptions & ConfirmationOptions) => {
      const impl = await import("./team.impl.js");
      await impl.leave(program, options);
    });

  team
    .command("update")
    .description("Update a team")
    .option("--team-id <id>", "Team ID")
    .option("--display-name <name>", "New team display name")
    .action(async (options: TeamOptions & { displayName?: string }) => {
      const impl = await import("./team.impl.js");
      await impl.update(program, options);
    });

  team
    .command("delete")
    .description("Delete a team")
    .option("--team-id <id>", "Team ID")
    .option("-y, --yes", "Skip the confirmation prompt")
    .action(async (options: TeamOptions & ConfirmationOptions) => {
      const impl = await import("./team.impl.js");
      await impl.deleteTeam(program, options);
    });
}
