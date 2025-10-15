import { isUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { it } from "../helpers";
import { createApp, scaffoldProject } from "./js-helpers";

it("should scaffold the project", async ({ expect }) => {
  const { project } = await scaffoldProject();
  expect(project.displayName).toBe("New Project");
});

it("should sign up with credential", async ({ expect }) => {
  const { clientApp } = await createApp();
  const result1 = await clientApp.signUpWithCredential({
    email: "test@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });

  expect(result1).toMatchInlineSnapshot(`
    {
      "data": undefined,
      "status": "ok",
    }
  `);

  const result2 = await clientApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  expect(result2).toMatchInlineSnapshot(`
    {
      "data": undefined,
      "status": "ok",
    }
  `);
});

it("should create user on the server", async ({ expect }) => {
  const { serverApp } = await createApp();
  const user = await serverApp.createUser({
    primaryEmail: "test@test.com",
    password: "password",
    primaryEmailAuthEnabled: true,
  });

  expect(isUuid(user.id)).toBe(true);

  const user2 = await serverApp.getUser(user.id);
  expect(user2?.id).toBe(user.id);

  const result = await serverApp.signInWithCredential({
    email: "test@test.com",
    password: "password",
  });

  expect(result).toMatchInlineSnapshot(`
    {
      "data": undefined,
      "status": "ok",
    }
  `);
});

it("should throw a helpful error when destructuring user", async ({ expect }) => {
  const { clientApp, serverApp } = await createApp();

  const email = "user-destructure@test.com";
  const password = "password";

  const signUpResult = await clientApp.signUpWithCredential({
    email,
    password,
    verificationCallbackUrl: "http://localhost:3000",
  });
  expect(signUpResult.status).toBe("ok");

  const signInResult = await clientApp.signInWithCredential({
    email,
    password,
  });
  expect(signInResult.status).toBe("ok");

  const currentUser = await clientApp.getUser({ or: "throw" });
  const accessClientUser = () => (currentUser as any).user;
  expect(accessClientUser).toThrowError("Stack Auth: useUser() already returns the user object. Use `const user = useUser()` (or `const user = await app.getUser()`) instead of destructuring it like `const { user } = ...`.");

  const serverUser = await serverApp.getUser(currentUser.id);
  if (!serverUser) {
    throw new Error("Expected server user to exist for destructure guard test");
  }
  const accessServerUser = () => (serverUser as any).user;
  expect(accessServerUser).toThrowError("Stack Auth: useUser() already returns the user object. Use `const user = useUser()` (or `const user = await app.getUser()`) instead of destructuring it like `const { user } = ...`.");
});
