import { it } from "../helpers";
import { createApp } from "./js-helpers";

it("should list anonymous users when includeAnonymous is true", async ({ expect }) => {
  const { serverApp, clientApp } = await createApp();

  // Create a regular user
  const regularUser = await serverApp.createUser({
    primaryEmail: "regular@test.com",
    password: "password",
    primaryEmailAuthEnabled: true,
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
  });

  // Create an anonymous user
  const anonymousUser = await clientApp.getUser({ or: "anonymous" });

  // List users without specifying includeAnonymous
  const users = await serverApp.listUsers();

  // Verify anonymous user is NOT included by default
  expect(users.map(u => u.id)).not.toContain(anonymousUser.id);
});
