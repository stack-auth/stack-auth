import { it } from "../helpers";
import { createApp } from "./js-helpers";

it("returns default item quantity for a team", async ({ expect }) => {
  const { clientApp, adminApp } = await createApp({
    config: {
      clientTeamCreationEnabled: true,
    },
  });

  const project = await adminApp.getProject();
  const itemId = "test_item";

  await project.updateConfig({
    [`payments.items.${itemId}`]: {
      displayName: "Test Item",
      customerType: "team",
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
  if (!user) throw new Error("User not found");

  const team = await user.createTeam({ displayName: "Test Team" });
  const item = await team.getItem(itemId);

  expect(item.displayName).toBe("Test Item");
  expect(item.quantity).toBe(0);
  expect(item.nonNegativeQuantity).toBe(0);
}, {
  timeout: 40_000,
});

it("root-level getItem works for user and team", async ({ expect }) => {
  const { clientApp, serverApp, adminApp } = await createApp({
    config: { clientTeamCreationEnabled: true },
  });

  const project = await adminApp.getProject();
  const itemId = "root_level_item";
  await project.updateConfig({
    [`payments.items.${itemId}`]: {
      displayName: "Root Level Item",
      customerType: "team",
    },
  });

  await clientApp.signUpWithCredential({ email: "rl@test.com", password: "password", verificationCallbackUrl: "http://localhost:3000" });
  await clientApp.signInWithCredential({ email: "rl@test.com", password: "password" });
  const user = await clientApp.getUser();
  if (!user) throw new Error("User not found");
  const team = await user.createTeam({ displayName: "RL Team" });

  const teamItem = await clientApp.getItem({ itemId, teamId: team.id });
  expect(teamItem.quantity).toBe(0);

  const userItemId = "root_level_user_item";
  await project.updateConfig({
    [`payments.items.${userItemId}`]: {
      displayName: "Root Level User Item",
      customerType: "user",
    },
  });
  const userItem = await serverApp.getItem({ itemId: userItemId, userId: user.id });
  expect(userItem.quantity).toBe(0);
}, { timeout: 60_000 });

it("customCustomerId is supported via root-level getItem and admin quantity change", async ({ expect }) => {
  const { clientApp, adminApp } = await createApp({
    config: {},
  });
  const project = await adminApp.getProject();
  const itemId = "custom_item_rl";
  await project.updateConfig({
    [`payments.items.${itemId}`]: {
      displayName: "Custom RL Item",
      customerType: "custom",
    },
  });
  const customCustomerId = "custom-abc";
  const before = await clientApp.getItem({ itemId, customCustomerId });
  expect(before.quantity).toBe(0);
  await adminApp.createItemQuantityChange({ customCustomerId, itemId, quantity: 5 });
  const after = await clientApp.getItem({ itemId, customCustomerId });
  expect(after.quantity).toBe(5);
}, { timeout: 60_000 });

it("admin can increase team item quantity and client sees updated value", async ({ expect }) => {
  const { clientApp, adminApp } = await createApp({
    config: {
      clientTeamCreationEnabled: true,
    },
  });

  const project = await adminApp.getProject();
  const itemId = "test_item_inc";

  await project.updateConfig({
    [`payments.items.${itemId}`]: {
      displayName: "Test Item Inc",
      customerType: "team",
    },
  });

  await clientApp.signUpWithCredential({
    email: "inc@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({ email: "inc@test.com", password: "password" });

  const user = await clientApp.getUser();
  expect(user).not.toBeNull();
  if (!user) throw new Error("User not found");

  const team = await user.createTeam({ displayName: "Team Inc" });

  const before = await team.getItem(itemId);
  expect(before.quantity).toBe(0);

  // Increase by 3 via admin API
  await adminApp.createItemQuantityChange({ teamId: team.id, itemId, quantity: 3 });

  const after = await team.getItem(itemId);
  expect(after.quantity).toBe(3);
  expect(after.nonNegativeQuantity).toBe(3);
}, { timeout: 40_000 });

it("cannot decrease team item quantity below zero", async ({ expect }) => {
  const { clientApp, adminApp } = await createApp({
    config: {
      clientTeamCreationEnabled: true,
    },
  });

  const project = await adminApp.getProject();
  const itemId = "test_item_dec";

  await project.updateConfig({
    [`payments.items.${itemId}`]: {
      displayName: "Test Item Dec",
      customerType: "team",
    },
  });

  await clientApp.signUpWithCredential({
    email: "dec@test.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({ email: "dec@test.com", password: "password" });

  const user = await clientApp.getUser();
  expect(user).not.toBeNull();
  if (!user) throw new Error("User not found");

  const team = await user.createTeam({ displayName: "Team Dec" });
  const current = await team.getItem(itemId);
  expect(current.quantity).toBe(0);

  // Try to decrease by 1 (should fail with KnownErrors.ItemQuantityInsufficientAmount)
  await expect(adminApp.createItemQuantityChange({ teamId: team.id, itemId, quantity: -1 }))
    .rejects.toThrow();

  const still = await team.getItem(itemId);
  expect(still.quantity).toBe(0);
}, { timeout: 40_000 });


it("can create item quantity change from server app", { timeout: 40_000 }, async ({ expect }) => {
  const { serverApp, adminApp } = await createApp({
    config: {
      clientTeamCreationEnabled: true,
    },
  });

  const project = await adminApp.getProject();
  const itemId = "test_item_change";

  await project.updateConfig({
    [`payments.items.${itemId}`]: {
      displayName: "Test Item Change",
      customerType: "user",
    },
  });

  const user = await serverApp.createUser({ primaryEmail: "test@test.com" });
  const item = await user.getItem(itemId);
  expect(item.quantity).toBe(0);
  expect(item.nonNegativeQuantity).toBe(0);
  expect(item.displayName).toBe("Test Item Change");

  await item.increaseQuantity(2);
  const newItem = await user.getItem(itemId);
  expect(newItem.quantity).toBe(2);

  await newItem.decreaseQuantity(1);
  const newItem2 = await user.getItem(itemId);
  expect(newItem2.quantity).toBe(1);

  const resultSuccess = await newItem2.tryDecreaseQuantity(1);
  expect(resultSuccess).toBe(true);
  const newItem3 = await user.getItem(itemId);
  expect(newItem3.quantity).toBe(0);

  const resultFailure = await newItem3.tryDecreaseQuantity(1);
  expect(resultFailure).toBe(false);
  const newItem4 = await user.getItem(itemId);
  expect(newItem4.quantity).toBe(0);
});
