import { it } from "../helpers";
import { createApp } from "./js-helpers";


it("should list team invitations for the current user via the client SDK", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp();

  // Create a team via a signed-in user
  await clientApp.signUpWithCredential({
    email: "team-owner@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "team-owner@test.com",
    password: "password",
  });
  const owner = await clientApp.getUser({ or: "throw" });
  const team = await owner.createTeam({ displayName: "Inviting Team" });

  // Invite a specific email address via the server SDK
  const serverTeam = await serverApp.getTeam(team.id);
  if (!serverTeam) throw new Error("Team not found on server");
  await serverTeam.inviteUser({
    email: "invited-user@test.com",
    callbackUrl: "http://localhost:3000/team-invite",
  });

  // Create a new user with that verified email and sign in
  await clientApp.signUpWithCredential({
    email: "invited-user@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "invited-user@test.com",
    password: "password",
  });
  // Verify the email server-side so the invitation lookup will find it
  const createdUser = await clientApp.getUser({ or: "throw" });
  const serverUser = await serverApp.getUser(createdUser.id);
  if (!serverUser) throw new Error("User not found on server");
  await serverUser.update({ primaryEmailVerified: true });

  // Re-fetch user after verification
  const user = await clientApp.getUser({ or: "throw" });

  // List team invitations for the current user
  const invitations = await user.listTeamInvitations();

  expect(invitations).toHaveLength(1);
  expect(invitations[0].teamId).toBe(team.id);
  expect(invitations[0].teamDisplayName).toBe("Inviting Team");
  expect(invitations[0].recipientEmail).toBe("invited-user@test.com");
  expect(invitations[0].expiresAt).toBeInstanceOf(Date);
  expect(invitations[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
});


it("should return empty invitations when user has no matching invitations", async ({ expect }) => {
  const { clientApp } = await createApp();

  await clientApp.signUpWithCredential({
    email: "no-invites@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "no-invites@test.com",
    password: "password",
  });
  const user = await clientApp.getUser({ or: "throw" });

  const invitations = await user.listTeamInvitations();
  expect(invitations).toHaveLength(0);
});


it("should list team invitations for a server user", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp();

  // Create team owner and team
  await clientApp.signUpWithCredential({
    email: "server-owner@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "server-owner@test.com",
    password: "password",
  });
  const owner = await clientApp.getUser({ or: "throw" });
  const team = await owner.createTeam({ displayName: "Server Test Team" });

  // Create a user with a verified email via the server SDK
  const invitedServerUser = await serverApp.createUser({
    primaryEmail: "server-invited@test.com",
    primaryEmailVerified: true,
  });

  // Send an invitation to that email
  const serverTeam = await serverApp.getTeam(team.id);
  if (!serverTeam) throw new Error("Team not found on server");
  await serverTeam.inviteUser({
    email: "server-invited@test.com",
    callbackUrl: "http://localhost:3000/team-invite",
  });

  // List invitations via the server user object
  const invitations = await invitedServerUser.listTeamInvitations();

  expect(invitations).toHaveLength(1);
  expect(invitations[0].teamId).toBe(team.id);
  expect(invitations[0].teamDisplayName).toBe("Server Test Team");
  expect(invitations[0].recipientEmail).toBe("server-invited@test.com");
});


it("should not return invitations for unverified emails", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp();

  // Create team and invite an email
  await clientApp.signUpWithCredential({
    email: "unverified-owner@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "unverified-owner@test.com",
    password: "password",
  });
  const owner = await clientApp.getUser({ or: "throw" });
  const team = await owner.createTeam({ displayName: "Unverified Test" });

  const serverTeam = await serverApp.getTeam(team.id);
  if (!serverTeam) throw new Error("Team not found on server");
  await serverTeam.inviteUser({
    email: "unverified-target@test.com",
    callbackUrl: "http://localhost:3000/team-invite",
  });

  // Create a user with that email but leave it unverified
  const unverifiedUser = await serverApp.createUser({
    primaryEmail: "unverified-target@test.com",
    primaryEmailVerified: false,
  });

  // Invitations should be empty because the email is not verified
  const invitations = await unverifiedUser.listTeamInvitations();
  expect(invitations).toHaveLength(0);
});


it("should list invitations from multiple teams", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp();

  // Create two teams
  await clientApp.signUpWithCredential({
    email: "multi-owner@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "multi-owner@test.com",
    password: "password",
  });
  const owner = await clientApp.getUser({ or: "throw" });
  const team1 = await owner.createTeam({ displayName: "Team Alpha" });
  const team2 = await owner.createTeam({ displayName: "Team Beta" });

  // Create the invited user with a verified email
  const invitedUser = await serverApp.createUser({
    primaryEmail: "multi-invited@test.com",
    primaryEmailVerified: true,
  });

  // Send invitations from both teams
  const serverTeam1 = await serverApp.getTeam(team1.id);
  if (!serverTeam1) throw new Error("Team 1 not found");
  await serverTeam1.inviteUser({
    email: "multi-invited@test.com",
    callbackUrl: "http://localhost:3000/team-invite",
  });

  const serverTeam2 = await serverApp.getTeam(team2.id);
  if (!serverTeam2) throw new Error("Team 2 not found");
  await serverTeam2.inviteUser({
    email: "multi-invited@test.com",
    callbackUrl: "http://localhost:3000/team-invite",
  });

  // List invitations
  const invitations = await invitedUser.listTeamInvitations();

  expect(invitations).toHaveLength(2);
  const teamNames = invitations.map(i => i.teamDisplayName).sort();
  expect(teamNames).toEqual(["Team Alpha", "Team Beta"]);
});


it("should accept a team invitation via the client SDK", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp();

  // Create a team
  await clientApp.signUpWithCredential({
    email: "accept-owner@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "accept-owner@test.com",
    password: "password",
  });
  const owner = await clientApp.getUser({ or: "throw" });
  const team = await owner.createTeam({ displayName: "Accept Test Team" });

  // Invite a user
  const serverTeam = await serverApp.getTeam(team.id);
  if (!serverTeam) throw new Error("Team not found on server");
  await serverTeam.inviteUser({
    email: "accept-user@test.com",
    callbackUrl: "http://localhost:3000/team-invite",
  });

  // Sign up as the invited user with verified email
  await clientApp.signUpWithCredential({
    email: "accept-user@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "accept-user@test.com",
    password: "password",
  });
  const createdUser = await clientApp.getUser({ or: "throw" });
  const serverCreatedUser = await serverApp.getUser(createdUser.id);
  if (!serverCreatedUser) throw new Error("User not found on server");
  await serverCreatedUser.update({ primaryEmailVerified: true });

  // List and accept the invitation
  const user = await clientApp.getUser({ or: "throw" });
  const invitations = await user.listTeamInvitations();
  expect(invitations).toHaveLength(1);

  await invitations[0].accept();

  // Verify user is now a member of the team
  const teams = await user.listTeams();
  const joinedTeam = teams.find(t => t.id === team.id);
  expect(joinedTeam).toBeDefined();
  expect(joinedTeam!.displayName).toBe("Accept Test Team");

  // Invitation should no longer be listed (it was used)
  const remainingInvitations = await user.listTeamInvitations();
  expect(remainingInvitations).toHaveLength(0);
});


it("should accept a team invitation via the server SDK", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp();

  // Create team
  await clientApp.signUpWithCredential({
    email: "server-accept-owner@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "server-accept-owner@test.com",
    password: "password",
  });
  const owner = await clientApp.getUser({ or: "throw" });
  const team = await owner.createTeam({ displayName: "Server Accept Team" });

  // Create user and send invitation
  const invitedUser = await serverApp.createUser({
    primaryEmail: "server-accept@test.com",
    primaryEmailVerified: true,
  });
  const serverTeam = await serverApp.getTeam(team.id);
  if (!serverTeam) throw new Error("Team not found on server");
  await serverTeam.inviteUser({
    email: "server-accept@test.com",
    callbackUrl: "http://localhost:3000/team-invite",
  });

  // Accept via server user
  const invitations = await invitedUser.listTeamInvitations();
  expect(invitations).toHaveLength(1);

  await invitations[0].accept();

  // Verify membership
  const teams = await invitedUser.listTeams();
  const joinedTeam = teams.find(t => t.id === team.id);
  expect(joinedTeam).toBeDefined();

  // Invitation consumed
  const remaining = await invitedUser.listTeamInvitations();
  expect(remaining).toHaveLength(0);
});
