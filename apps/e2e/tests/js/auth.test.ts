import { it } from "../helpers";
import { scaffoldProject } from "./js-helpers";
import { StackClientApp } from '@stackframe/js';
import { STACK_BACKEND_BASE_URL } from '../helpers';
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { randomUUID } from "crypto";

it("should sign up with password", async ({ expect }) => {
  const { project, clientApp } = await scaffoldProject();

  const email = `${randomUUID()}@stack-js-test.example.com`;
  const password = generateSecureRandomString();

  const result = await clientApp.signUpWithCredential({
    email,
    password,
  });

  expect(result.status).toBe('ok');

  const user = await clientApp.getUser({
    or: 'throw',
  });

  expect(user).toBeDefined();
  expect(user.primaryEmail).toBe(email);
});

it("should sign in with password", async ({ expect }) => {
  const { project, clientApp } = await scaffoldProject();

  const email = `${randomUUID()}@stack-js-test.example.com`;
  const password = generateSecureRandomString();

  // Sign up first
  await clientApp.signUpWithCredential({
    email,
    password,
  });

  // Sign out
  const auth = await clientApp.getUser({ or: 'throw' });
  await auth.signOut();

  // Sign in
  const result = await clientApp.signInWithCredential({
    email,
    password,
  });

  expect(result.status).toBe('ok');

  const user = await clientApp.getUser({
    or: 'throw',
  });

  expect(user).toBeDefined();
  expect(user.primaryEmail).toBe(email);
});

it("should sign out successfully", async ({ expect }) => {
  const { project, clientApp } = await scaffoldProject();

  const email = `${randomUUID()}@stack-js-test.example.com`;
  const password = generateSecureRandomString();

  // Sign up first
  await clientApp.signUpWithCredential({
    email,
    password,
  });

  // Verify user is signed in
  const userBefore = await clientApp.getUser();
  expect(userBefore).not.toBeNull();

  // Sign out
  if (userBefore) {
    await userBefore.signOut();
  }

  // Verify user is signed out
  const userAfter = await clientApp.getUser();
  expect(userAfter).toBeNull();
});

it("should handle invalid credentials when signing in", async ({ expect }) => {
  const { project, clientApp } = await scaffoldProject();

  const email = `${randomUUID()}@stack-js-test.example.com`;
  const password = generateSecureRandomString();
  const wrongPassword = generateSecureRandomString();

  // Sign up first
  await clientApp.signUpWithCredential({
    email,
    password,
  });

  // Sign out
  const user = await clientApp.getUser({ or: 'throw' });
  await user.signOut();

  // Try to sign in with wrong password
  const result = await clientApp.signInWithCredential({
    email,
    password: wrongPassword,
  });

  expect(result.status).toBe('error');

  // Verify user is still signed out
  const userAfterSignIn = await clientApp.getUser();
  expect(userAfterSignIn).toBeNull();
});

it("should handle sign up with existing email", async ({ expect }) => {
  const { project, clientApp } = await scaffoldProject();

  const email = `${randomUUID()}@stack-js-test.example.com`;
  const password1 = generateSecureRandomString();
  const password2 = generateSecureRandomString();

  // Sign up first time
  await clientApp.signUpWithCredential({
    email,
    password: password1,
  });

  // Sign out
  const user = await clientApp.getUser({ or: 'throw' });
  await user.signOut();

  // Try to sign up again with same email
  const result = await clientApp.signUpWithCredential({
    email,
    password: password2,
  });

  expect(result.status).toBe('error');
});
