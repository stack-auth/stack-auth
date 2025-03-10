import { it } from "../helpers";
import { scaffoldProject } from "./js-helpers";
import { StackClientApp } from '@stackframe/js';
import { STACK_BACKEND_BASE_URL } from '../helpers';
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { randomUUID } from "crypto";

it("should create and manage teams", async ({ expect }) => {
  const { project, clientApp } = await scaffoldProject({ teamsEnabled: true });

  const email = `${randomUUID()}@stack-js-test.example.com`;
  const password = generateSecureRandomString();

  await clientApp.signUpWithCredential({
    email,
    password,
  });

  const user = await clientApp.getUser({
    or: 'throw',
  });

  // Create team
  const teamName = "Test Team";
  const team = await user.createTeam({
    displayName: teamName,
  });

  expect(team).toBeDefined();
  expect(team.displayName).toBe(teamName);
  expect(team.id).toBeDefined();

  // List teams
  const teams = await user.listTeams();

  expect(teams).toContainEqual(expect.objectContaining({
    id: team.id,
    displayName: teamName,
  }));

  // Update team
  const updatedTeamName = "Updated Team";
  await team.update({
    displayName: updatedTeamName,
  });

  // Get updated team
  const updatedTeam = await user.getTeam(team.id);

  if (updatedTeam) {
    expect(updatedTeam.displayName).toBe(updatedTeamName);
  } else {
    expect(updatedTeam).not.toBeNull();
  }
});

it("should handle team permissions", async ({ expect }) => {
  const { project, clientApp } = await scaffoldProject({ teamsEnabled: true });

  const email = `${randomUUID()}@stack-js-test.example.com`;
  const password = generateSecureRandomString();

  await clientApp.signUpWithCredential({
    email,
    password,
  });

  const user = await clientApp.getUser({
    or: 'throw',
  });

  // Create team
  const team = await user.createTeam({
    displayName: "Permissions Test Team",
  });

  // List permissions
  const permissions = await user.listPermissions(team);

  expect(permissions).toBeDefined();
  expect(Array.isArray(permissions)).toBe(true);

  // Check if user has permission
  // Log the team object to see what's in it
  console.log("Team object:", team);
  console.log("Team ID:", team.id);

  // Log the permissions we already got
  console.log("Permissions:", permissions);

  // Then check for a specific permission
  // The hasPermission method expects (team, permissionId) as parameters
  const hasPermission = await user.hasPermission(team, "admin");

  expect(hasPermission).toBe(true);
});
