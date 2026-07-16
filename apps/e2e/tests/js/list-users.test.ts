import { it } from "../helpers";
import { createApp } from "./js-helpers";

it("should list anonymous users when includeAnonymous is true", async ({ expect }) => {
  const { serverApp, clientApp } = await createApp();

  // Create a regular user
  const regularUser = await serverApp.createUser({
    primaryEmail: "regular@test.com",
    password: "password",
    primaryEmailAuthEnabled: true,
    primaryEmailVerified: true,
  });

  // Create anonymous users
  const anonymousUser1 = await clientApp.getUser({ or: "anonymous", tokenStore: { headers: new Headers() } });
  await anonymousUser1.signOut();
  const anonymousUser2 = await clientApp.getUser({ or: "anonymous", tokenStore: { headers: new Headers() } });

  expect(anonymousUser1.id).not.toBe(anonymousUser2.id);

  // List users without includeAnonymous
  const usersWithoutAnonymous = await serverApp.listUsers({ includeAnonymous: false, orderBy: "signedUpAt" });
  const userIdsWithoutAnonymous = usersWithoutAnonymous.map(u => u.id);
  expect(userIdsWithoutAnonymous).toEqual([regularUser.id]);

  // List users with includeAnonymous
  const usersWithAnonymous = await serverApp.listUsers({ includeAnonymous: true, orderBy: "signedUpAt" });
  const userIdsWithAnonymous = usersWithAnonymous.map(u => u.id);
  expect(userIdsWithAnonymous).toEqual([regularUser.id, anonymousUser1.id, anonymousUser2.id]);
});

it("should default to excluding anonymous users when includeAnonymous is not specified", async ({ expect }) => {
  const { serverApp, clientApp } = await createApp();

  // Create a regular user
  await serverApp.createUser({
    primaryEmail: "regular2@test.com",
    password: "password",
    primaryEmailAuthEnabled: true,
    primaryEmailVerified: true,
  });

  // Create an anonymous user
  const anonymousUser = await clientApp.getUser({ or: "anonymous" });

  // List users without specifying includeAnonymous
  const users = await serverApp.listUsers();

  // Verify anonymous user is NOT included by default
  expect(users.map(u => u.id)).not.toContain(anonymousUser.id);
});

it("should list only anonymous users when onlyAnonymous is true", async ({ expect }) => {
  const { serverApp, clientApp } = await createApp();

  const regularUser = await serverApp.createUser({
    primaryEmail: "regular3@test.com",
    password: "password",
    primaryEmailAuthEnabled: true,
    primaryEmailVerified: true,
  });

  const anonymousUser1 = await clientApp.getUser({ or: "anonymous", tokenStore: { headers: new Headers() } });
  await anonymousUser1.signOut();
  const anonymousUser2 = await clientApp.getUser({ or: "anonymous", tokenStore: { headers: new Headers() } });

  const anonymousOnlyUsers = await serverApp.listUsers({ onlyAnonymous: true, includeAnonymous: true, orderBy: "signedUpAt" });
  const anonymousOnlyUserIds = anonymousOnlyUsers.map((u) => u.id);

  expect(anonymousOnlyUserIds).toContain(anonymousUser1.id);
  expect(anonymousOnlyUserIds).toContain(anonymousUser2.id);
  expect(anonymousOnlyUserIds).not.toContain(regularUser.id);
});

it("should exclude users by primary email domain", async ({ expect }) => {
  const { serverApp } = await createApp();

  const gmailUser = await serverApp.createUser({
    primaryEmail: "blocked@gmail.com",
    primaryEmailVerified: true,
  });
  const yahooUser = await serverApp.createUser({
    primaryEmail: "blocked@yahoo.com",
    primaryEmailVerified: true,
  });
  const companyUser = await serverApp.createUser({
    primaryEmail: "kept@company.example",
    primaryEmailVerified: true,
  });
  const secondaryMatchUser = await serverApp.createUser({
    primaryEmail: "secondary@company.example",
    primaryEmailVerified: true,
  });
  await secondaryMatchUser.createContactChannel({
    type: "email",
    value: "secondary@gmail.com",
    isVerified: true,
    usedForAuth: false,
  });
  const noEmailUser = await serverApp.createUser({
    displayName: "No Email",
  });

  const users = await serverApp.listUsers({
    includeRestricted: true,
    excludedEmailDomains: ["gmail.com", "YAHOO.com"],
    orderBy: "signedUpAt",
  });
  const userIds = users.map((user) => user.id);

  expect(userIds).not.toContain(gmailUser.id);
  expect(userIds).not.toContain(yahooUser.id);
  expect(userIds).toContain(companyUser.id);
  expect(userIds).toContain(secondaryMatchUser.id);
  expect(userIds).toContain(noEmailUser.id);
});
