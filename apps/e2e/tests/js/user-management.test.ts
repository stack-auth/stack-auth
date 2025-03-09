import { it } from "../helpers";
import { scaffoldProject } from "./js-helpers";
import { StackClientApp } from '@stackframe/js';
import { STACK_BACKEND_BASE_URL } from '../helpers';
import { generateSecureRandomString } from "@stackframe/stack-shared/dist/utils/crypto";
import { randomUUID } from "crypto";

it("should get current user", async ({ expect }) => {
  const { project, clientApp } = await scaffoldProject();

  const email = `${randomUUID()}@stack-js-test.example.com`;
  const password = generateSecureRandomString();

  await clientApp.signUpWithCredential({
    email,
    password,
  });

  const user = await clientApp.getUser({
    or: 'throw',
  });

  expect(user).toBeDefined();
  expect(user.primaryEmail).toBe(email);
  expect(user.id).toBeDefined();
});

it("should update user profile", async ({ expect }) => {
  const { project, clientApp } = await scaffoldProject();

  const email = `${randomUUID()}@stack-js-test.example.com`;
  const password = generateSecureRandomString();

  await clientApp.signUpWithCredential({
    email,
    password,
  });

  const user = await clientApp.getUser({
    or: 'throw',
  });

  // Update display name
  const displayName = "Test User";
  await user.setDisplayName(displayName);

  // Get updated user
  const updatedUser = await clientApp.getUser({
    or: 'throw',
  });

  expect(updatedUser.displayName).toBe(displayName);
});

it("should update client metadata", async ({ expect }) => {
  const { project, clientApp } = await scaffoldProject();

  const email = `${randomUUID()}@stack-js-test.example.com`;
  const password = generateSecureRandomString();

  await clientApp.signUpWithCredential({
    email,
    password,
  });

  const user = await clientApp.getUser({
    or: 'throw',
  });

  // Update client metadata
  const metadata = { key: "value" };
  await user.setClientMetadata(metadata);

  // Get updated user again
  const updatedUserWithMetadata = await clientApp.getUser({
    or: 'throw',
  });

  expect(updatedUserWithMetadata.clientMetadata).toEqual(metadata);
});

it("should handle user not found gracefully", async ({ expect }) => {
  const { project, clientApp } = await scaffoldProject();

  // Try to get user without signing in
  const user = await clientApp.getUser();

  expect(user).toBeNull();
});
