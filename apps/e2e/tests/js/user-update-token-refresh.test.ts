import * as jose from "jose";
import { it } from "../helpers";
import { createApp } from "./js-helpers";

/**
 * Tests that verify JWT tokens are properly refreshed after user update operations
 */

const signUp = async (clientApp: any, email: string = "test@test.com") => {
  await clientApp.signUpWithCredential({
    email,
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
};

it("should refresh JWT token with updated selected_team_id after setSelectedTeam", async ({ expect }) => {
  // Create app with team creation enabled
  const { clientApp } = await createApp({
    config: {
      clientTeamCreationEnabled: true,
    },
  });

  // Sign up a user
  await signUp(clientApp);
  const user = await clientApp.getUser({ or: "throw" });

  // Get initial token and verify initial selected_team_id
  const initialAccessToken = await user.getAccessToken();
  expect(initialAccessToken).toBeDefined();
  const initialPayload = jose.decodeJwt(initialAccessToken!);
  const initialSelectedTeamId = initialPayload.selected_team_id;

  // Create a new team
  const newTeam = await user.createTeam({ displayName: "New Test Team" });
  expect(newTeam.id).toBeDefined();

  // Switch to the new team using setSelectedTeam
  await user.setSelectedTeam(newTeam);

  // Get the new access token after setSelectedTeam
  const newAccessToken = await user.getAccessToken();
  expect(newAccessToken).toBeDefined();

  // Decode and verify the new token has the updated selected_team_id
  const newPayload = jose.decodeJwt(newAccessToken!);

  // The new token should have the new team's ID
  expect(newPayload.selected_team_id).toBe(newTeam.id);

  // The token should have changed (new token issued)
  expect(newAccessToken).not.toBe(initialAccessToken);

  // Verify the selected_team_id actually changed
  expect(newPayload.selected_team_id).not.toBe(initialSelectedTeamId);
});

it("should refresh JWT token with updated selected_team_id after user.update", async ({ expect }) => {
  // Create app with team creation enabled
  const { clientApp } = await createApp({
    config: {
      clientTeamCreationEnabled: true,
    },
  });

  // Sign up a user
  await signUp(clientApp, "update-test@test.com");
  const user = await clientApp.getUser({ or: "throw" });

  // Get initial access token
  const initialAccessToken = await user.getAccessToken();
  expect(initialAccessToken).toBeDefined();

  // Create a new team
  const newTeam = await user.createTeam({ displayName: "Update Test Team" });

  // Update user's selected team using the update method
  await user.update({ selectedTeamId: newTeam.id });

  // Get the new access token after update
  const newAccessToken = await user.getAccessToken();
  expect(newAccessToken).toBeDefined();

  // Decode and verify the new token has the updated selected_team_id
  const newPayload = jose.decodeJwt(newAccessToken!);
  expect(newPayload.selected_team_id).toBe(newTeam.id);

  // The token should have changed
  expect(newAccessToken).not.toBe(initialAccessToken);
});

it("should have different tokens before and after setSelectedTeam (old token not reused)", async ({ expect }) => {
  // Create app with team creation enabled
  const { clientApp } = await createApp({
    config: {
      clientTeamCreationEnabled: true,
    },
  });

  // Sign up a user
  await signUp(clientApp, "token-change@test.com");
  const user = await clientApp.getUser({ or: "throw" });

  // Get initial tokens
  const initialTokens = await user.currentSession.getTokens();
  const initialAccessToken = initialTokens.accessToken;
  expect(initialAccessToken).toBeDefined();

  // Create and switch to a new team
  const newTeam = await user.createTeam({ displayName: "Token Change Team" });
  await user.setSelectedTeam(newTeam);

  // Get tokens after the switch
  const newTokens = await user.currentSession.getTokens();
  const newAccessToken = newTokens.accessToken;
  expect(newAccessToken).toBeDefined();

  // Access tokens should be different (new token issued with updated claims)
  expect(newAccessToken).not.toBe(initialAccessToken);

  // Verify the new token has the correct claim
  const newPayload = jose.decodeJwt(newAccessToken!);
  expect(newPayload.selected_team_id).toBe(newTeam.id);

  // Verify the old token (if decoded) would have the old team ID
  const oldPayload = jose.decodeJwt(initialAccessToken!);
  expect(oldPayload.selected_team_id).not.toBe(newTeam.id);
});

it("should update JWT claims when switching between multiple teams", async ({ expect }) => {
  // Create app with team creation enabled
  const { clientApp } = await createApp({
    config: {
      clientTeamCreationEnabled: true,
    },
  });

  // Sign up a user
  await signUp(clientApp, "multi-team@test.com");
  const user = await clientApp.getUser({ or: "throw" });

  // Create two teams
  const team1 = await user.createTeam({ displayName: "Team One" });
  const team2 = await user.createTeam({ displayName: "Team Two" });

  // Switch to team1
  await user.setSelectedTeam(team1);
  const token1 = await user.getAccessToken();
  expect(token1).toBeDefined();
  const payload1 = jose.decodeJwt(token1!);
  expect(payload1.selected_team_id).toBe(team1.id);

  // Switch to team2
  await user.setSelectedTeam(team2);
  const token2 = await user.getAccessToken();
  expect(token2).toBeDefined();
  const payload2 = jose.decodeJwt(token2!);
  expect(payload2.selected_team_id).toBe(team2.id);

  // Switch back to team1
  await user.setSelectedTeam(team1);
  const token3 = await user.getAccessToken();
  expect(token3).toBeDefined();
  const payload3 = jose.decodeJwt(token3!);
  expect(payload3.selected_team_id).toBe(team1.id);

  // All three tokens should be different (new tokens issued each time)
  expect(token1).not.toBe(token2);
  expect(token2).not.toBe(token3);
  expect(token1).not.toBe(token3);
});
