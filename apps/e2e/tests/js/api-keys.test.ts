import { it } from "../helpers";
import { createApp } from "./js-helpers";


it("should be able to create and update user api keys", async ({ expect }) => {
  const { clientApp } = await createApp({
    config: {
      allowTeamApiKeys: true,
      allowUserApiKeys: true,
    },
  });


  await clientApp.signUpWithCredential({
    email: "test@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });

  await clientApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  const user = await clientApp.getUser();

  expect(user).not.toBeNull();

  if (!user) {
    throw new Error("User not found");
  }


  const createApiKeyResponse = await user.createApiKey({
    description: "test",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  });

  expect(createApiKeyResponse).toMatchInlineSnapshot(`
    {
      "createdAt": <stripped field 'createdAt'>,
      "description": "test",
      "expiresAt": Date {},
      "id": "<stripped UUID>",
      "isValid"(...): { ... },
      "manuallyRevokedAt": null,
      "revoke"(...): { ... },
      "type": "user",
      "update"(...): { ... },
      "userId": "<stripped UUID>",
      "value": sk_<stripped user API key>,
      "whyInvalid"(...): { ... },
    }
  `);

  const listApiKeysResponse = await user.listApiKeys();

  expect(listApiKeysResponse).toMatchInlineSnapshot(`
    [
      {
        "createdAt": <stripped field 'createdAt'>,
        "description": "test",
        "expiresAt": Date {},
        "id": "<stripped UUID>",
        "isValid"(...): { ... },
        "manuallyRevokedAt": null,
        "revoke"(...): { ... },
        "type": "user",
        "update"(...): { ... },
        "userId": "<stripped UUID>",
        "value": { "lastFour": <stripped field 'lastFour'> },
        "whyInvalid"(...): { ... },
      },
    ]
  `);

  await listApiKeysResponse[0].update({
    description: "test2",
  });


  const listApiKeysResponse2 = await user.listApiKeys();

  expect(listApiKeysResponse2).toMatchInlineSnapshot(`
    [
      {
        "createdAt": <stripped field 'createdAt'>,
        "description": "test2",
        "expiresAt": Date {},
        "id": "<stripped UUID>",
        "isValid"(...): { ... },
        "manuallyRevokedAt": null,
        "revoke"(...): { ... },
        "type": "user",
        "update"(...): { ... },
        "userId": "<stripped UUID>",
        "value": { "lastFour": <stripped field 'lastFour'> },
        "whyInvalid"(...): { ... },
      },
    ]
  `);

});

it("should be able to get user by api key from server app", async ({ expect }) => {

  const { clientApp, serverApp } = await createApp({
    config: {
      allowTeamApiKeys: true,
      allowUserApiKeys: true,
    },
  });

  // Create and sign in a user
  await clientApp.signUpWithCredential({
    email: "test@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });

  await clientApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  const user = await clientApp.getUser();
  expect(user).not.toBeNull();
  if (!user) {
    throw new Error("User not found");
  }

  // Create an API key for the user
  const createApiKeyResponse = await user.createApiKey({
    description: "test",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  });

  // Get the user using the server app and the API key
  const userByApiKey = await serverApp.getUser({ apiKey: createApiKeyResponse.value });
  expect(userByApiKey).not.toBeNull();
  if (!userByApiKey) {
    throw new Error("User not found by API key");
  }

  // Verify the user details match
  expect(userByApiKey.id).toBe(user.id);
  expect(userByApiKey.primaryEmail).toBe("test@test.com");
});

it("should be able to revoke an API key from the client and server should not be able to get the user", async ({ expect }) => {
  const { clientApp,serverApp } = await createApp({
    config: {
      allowTeamApiKeys: true,
      allowUserApiKeys: true,
    },
  });

  // Create and sign in a user
  await clientApp.signUpWithCredential({
    email: "test@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });

  await clientApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  const user = await clientApp.getUser();
  expect(user).not.toBeNull();
  if (!user) {
    throw new Error("User not found");
  }

  // Create an API key for the user
  const createApiKeyResponse = await user.createApiKey({
    description: "test",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  });

  // Verify the API key is valid initially
  expect(createApiKeyResponse.isValid()).toBe(true);

  // Revoke the API key
  await createApiKeyResponse.revoke();

  const listApiKeysResponse = await user.listApiKeys();

  // Verify the API key is no longer valid
  expect(listApiKeysResponse.find(key => key.id === createApiKeyResponse.id)?.isValid()).toBe(false);
  expect(listApiKeysResponse.find(key => key.id === createApiKeyResponse.id)?.manuallyRevokedAt).not.toBeNull();

  // Verify the API key is no longer valid when checked by the server app
  const userByApiKey = await serverApp.getUser({ apiKey: createApiKeyResponse.value });
  expect(userByApiKey).toBeNull();
});

it("should be able to revoke an API key from the server", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp({
    config: {
      allowTeamApiKeys: true,
      allowUserApiKeys: true,
    },
  });

  // Create and sign in a user
  await clientApp.signUpWithCredential({
    email: "test@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });

  await clientApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  const user = await clientApp.getUser();
  expect(user).not.toBeNull();
  if (!user) {
    throw new Error("User not found");
  }

  // Create an API key for the user
  const createApiKeyResponse = await user.createApiKey({
    description: "test",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  });

  // Verify the API key is valid initially
  expect(createApiKeyResponse.isValid()).toBe(true);

  // Get the user using the server app and the API key
  const userByApiKey = await serverApp.getUser({ apiKey: createApiKeyResponse.value });
  expect(userByApiKey).not.toBeNull();
  if (!userByApiKey) {
    throw new Error("User not found by API key");
  }

  // Revoke the API key using the server app
  await userByApiKey.listApiKeys().then(keys => {
    const apiKey = keys.find(key => key.id === createApiKeyResponse.id);
    expect(apiKey).not.toBeNull();
    if (!apiKey) {
      throw new Error("API key not found");
    }
    return apiKey.revoke();
  });


  const listApiKeysResponse = await user.listApiKeys();

  // Verify the API key is no longer valid
  expect(listApiKeysResponse.find(key => key.id === createApiKeyResponse.id)?.isValid()).toBe(false);
  expect(listApiKeysResponse.find(key => key.id === createApiKeyResponse.id)?.manuallyRevokedAt).not.toBeNull();

  // Verify the server app can no longer get the user with the revoked API key
  const userAfterRevoke = await serverApp.getUser({ apiKey: createApiKeyResponse.value });
  expect(userAfterRevoke).toBeNull();
});

it("should be able to create a team, add an API key, and get the team from the API key", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp({
    config: {
      allowTeamApiKeys: true,
      allowUserApiKeys: true,
      clientTeamCreationEnabled: true,
    },
  });

  // Create and sign in a user
  await clientApp.signUpWithCredential({
    email: "test@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });

  await clientApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  const user = await clientApp.getUser();
  expect(user).not.toBeNull();
  if (!user) {
    throw new Error("User not found");
  }

  // Create a team
  const team = await user.createTeam({
    displayName: "Test Team",
  });

  expect(team).not.toBeNull();
  expect(team.displayName).toBe("Test Team");

  // Create an API key for the team
  const createApiKeyResponse = await team.createApiKey({
    description: "Team API Key",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
  });

  expect(createApiKeyResponse).not.toBeNull();
  expect(createApiKeyResponse.description).toBe("Team API Key");
  expect(createApiKeyResponse.type).toBe("team");
  expect(createApiKeyResponse.isValid()).toBe(true);

  // Get the team using the server app and the API key
  const teamByApiKey = await serverApp.getTeam({ apiKey: createApiKeyResponse.value });
  expect(teamByApiKey).not.toBeNull();
  if (!teamByApiKey) {
    throw new Error("Team not found by API key");
  }

  // Verify the team details match
  expect(teamByApiKey.id).toBe(team.id);
  expect(teamByApiKey.displayName).toBe("Test Team");
});

it("should not be able to get a user with a team API key", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp({
    config: {
      allowTeamApiKeys: true,
      allowUserApiKeys: true,
      clientTeamCreationEnabled: true,
    },
  });

  // Create and sign in a user
  await clientApp.signUpWithCredential({
    email: "test@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });

  await clientApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  const user = await clientApp.getUser();
  expect(user).not.toBeNull();
  if (!user) {
    throw new Error("User not found");
  }

  // Create a team
  const team = await user.createTeam({
    displayName: "Test Team",
  });

  expect(team).not.toBeNull();
  expect(team.displayName).toBe("Test Team");

  // Create an API key for the team
  const createApiKeyResponse = await team.createApiKey({
    description: "Team API Key",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
  });

  expect(createApiKeyResponse).not.toBeNull();
  expect(createApiKeyResponse.description).toBe("Team API Key");
  expect(createApiKeyResponse.type).toBe("team");
  expect(createApiKeyResponse.isValid()).toBe(true);

  // Try to get the user using the server app and the team API key
  // This should return null as team API keys cannot be used to access user data
  const userByTeamApiKey = await serverApp.getUser({ apiKey: createApiKeyResponse.value });
  expect(userByTeamApiKey).toBeNull();
});

it("should not allow team members without manage API key permission to manage team API keys", async ({ expect }) => {

  // Create a new project
  const { clientApp, serverApp } = await createApp({
    config: {
      allowTeamApiKeys: true,
      allowUserApiKeys: true,
      clientTeamCreationEnabled: true,
    },
  });

  // Create and sign in the team owner
  await clientApp.signUpWithCredential({
    email: "owner@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });

  await clientApp.signInWithCredential({
    email: "owner@test.com",
    password: "password",
  });

  const owner = await clientApp.getUser();
  expect(owner).not.toBeNull();
  if (!owner) {
    throw new Error("Owner not found");
  }

  // Create a team
  const team = await owner.createTeam({
    displayName: "Test Team",
  });


  expect(team).not.toBeNull();
  expect(team.displayName).toBe("Test Team");

  const apiKey = await team.createApiKey({
    description: "Team API Key",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  });

  expect(apiKey).not.toBeNull();

  // Create a team member without manage API key permission
  await clientApp.signUpWithCredential({
    email: "member@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });

  await clientApp.signInWithCredential({
    email: "member@test.com",
    password: "password",
  });

  const member = await clientApp.getUser();
  expect(member).not.toBeNull();
  if (!member) {
    throw new Error("Member not found");
  }

  // Switch back to owner context to invite the member
  await clientApp.signInWithCredential({
    email: "owner@test.com",
    password: "password",
  });


  // Use server to add member to team
  const server_team = await serverApp.getTeam(team.id);
  expect(server_team).not.toBeNull();
  if (!server_team) {
    throw new Error("Team not found");
  }

  await server_team.addUser(member.id);


  // Switch back to member context
  await clientApp.signInWithCredential({
    email: "member@test.com",
    password: "password",
  });

  const member_user = await clientApp.getUser();
  expect(member_user).not.toBeNull();
  if (!member_user) {
    throw new Error("Member not found");
  }

  const team_from_member = await member_user.getTeam(team.id);

  expect(team_from_member).not.toBeNull();
  if (!team_from_member) {
    throw new Error("Team not found");
  }

  // Try to create a team API key - should fail
  await expect(team_from_member.createApiKey({
    description: "Team API Key",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
  })).rejects.toThrow();

  // Try to list team API keys - should fail
  await expect(team_from_member.listApiKeys()).rejects.toThrow();
});

