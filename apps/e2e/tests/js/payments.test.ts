import { it } from "../helpers";
import { createApp } from "./js-helpers";

it("createCheckoutUrl supports optional returnUrl and embeds it", async ({ expect }) => {
  const { clientApp, adminApp } = await createApp({ config: {} });
  const project = await adminApp.getProject();
  await adminApp.setupPayments();
  await project.updateConfig({
    "payments.offers.test-offer": {
      displayName: "Test Offer",
      customerType: "user",
      serverOnly: false,
      stackable: false,
      prices: { monthly: { USD: "1000", interval: [1, "month"] } },
      includedItems: {},
    },
  });

  await clientApp.signUpWithCredential({ email: "checkout-return@test.com", password: "password", verificationCallbackUrl: "http://localhost:3000" });
  await clientApp.signInWithCredential({ email: "checkout-return@test.com", password: "password" });
  const user = await clientApp.getUser();
  if (!user) throw new Error("User not found");

  const url = await user.createCheckoutUrl({ productId: "test-offer", returnUrl: "http://stack-test.localhost/after" });
  expect(url).toMatch(/^https?:\/\/localhost:8101\/purchase\/[a-z0-9-_]+\?return_url=/);
  const urlObj = new URL(url);
  expect(urlObj.searchParams.get("return_url")).toBe("http://stack-test.localhost/after");
}, { timeout: 60_000 });

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
  const { clientApp, serverApp, adminApp } = await createApp({
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
  const item = await serverApp.getItem({ teamId: team.id, itemId });
  const success = await item.tryDecreaseQuantity(1);
  expect(success).toBe(false);

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

const baseConfig = {
  clientTeamCreationEnabled: true,
} as const;

const paymentsOffersConfig = {
  "payments.offers.test-offer": {
    displayName: "Config Offer",
    customerType: "user",
    serverOnly: false,
    stackable: true,
    prices: { monthly: { USD: "1500", interval: [1, "month"] } },
    includedItems: {},
  },
  "payments.offers.team-offer": {
    displayName: "Team Config Offer",
    customerType: "team",
    serverOnly: false,
    stackable: false,
    prices: { yearly: { USD: "10000", interval: [1, "year"] } },
    includedItems: {},
  },
  "payments.offers.custom-offer": {
    displayName: "Custom Config Offer",
    customerType: "custom",
    serverOnly: false,
    stackable: false,
    prices: { lifetime: { USD: "2500" } },
    includedItems: {},
  },
};

async function setupCustomerProductsScenario() {
  const apps = await createApp({ config: baseConfig });
  const project = await apps.adminApp.getProject();
  await apps.adminApp.setupPayments();
  await project.updateConfig(paymentsOffersConfig);
  return apps;
}

it("grants and lists config plus inline products for users", { timeout: 60_000 }, async ({ expect }) => {
  const { clientApp, serverApp, adminApp } = await setupCustomerProductsScenario();

  await clientApp.signUpWithCredential({
    email: "products@example.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "products@example.com",
    password: "password",
  });

  const user = await clientApp.getUser();
  if (!user) throw new Error("User not found");

  await serverApp.grantProduct({ userId: user.id, productId: "test-offer", quantity: 2 });

  const inlineUserProduct = {
    display_name: "Inline User Offer",
    customer_type: "user",
    server_only: false,
    stackable: true,
    prices: {
      onetime: { USD: "500" },
    },
    included_items: {},
  } as const;
  await serverApp.grantProduct({ userId: user.id, product: inlineUserProduct });

  const allUserProducts = await clientApp.listProducts({ userId: user.id });
  expect(allUserProducts).toHaveLength(2);
  expect(allUserProducts.nextCursor).toBeNull();
  const configGrant = allUserProducts.find((product) => product.displayName === "Config Offer");
  expect(configGrant?.quantity).toBe(2);
  const inlineGrant = allUserProducts.find((product) => product.displayName === inlineUserProduct.display_name);
  expect(inlineGrant?.quantity).toBe(1);

  const paginatedUserProducts = await serverApp.listProducts({ userId: user.id, limit: 1 });
  expect(paginatedUserProducts).toHaveLength(1);
  expect(paginatedUserProducts.nextCursor).not.toBeNull();
  const nextPage = await serverApp.listProducts({ userId: user.id, cursor: paginatedUserProducts.nextCursor!, limit: 1 });
  expect(nextPage).toHaveLength(1);
  expect(nextPage.nextCursor).toBeNull();

  const userProductsFromCustomer = await user.listProducts();
  expect(userProductsFromCustomer).toHaveLength(2);
});

it("supports granting products to team and custom customers", { timeout: 60_000 }, async ({ expect }) => {
  const { clientApp, serverApp } = await setupCustomerProductsScenario();

  await clientApp.signUpWithCredential({
    email: "teams@example.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "teams@example.com",
    password: "password",
  });

  const user = await clientApp.getUser();
  if (!user) throw new Error("User not found");

  const team = await user.createTeam({ displayName: "Products Team" });
  await serverApp.grantProduct({ teamId: team.id, productId: "team-offer" });

  const inlineTeamProduct = {
    display_name: "Team Inline Offer",
    customer_type: "team",
    server_only: false,
    stackable: true,
    prices: {
      quarterly: { USD: "2500" },
    },
    included_items: {},
  } as const;
  await serverApp.grantProduct({ teamId: team.id, product: inlineTeamProduct, quantity: 1 });

  const teamProducts = await serverApp.listProducts({ teamId: team.id });
  expect(teamProducts).toHaveLength(2);
  const inlineGrant = teamProducts.find((product) => product.displayName === inlineTeamProduct.display_name);
  expect(inlineGrant?.quantity).toBe(1);

  const customCustomerId = "custom-products-id";
  const inlineCustomProduct = {
    display_name: "Custom Inline Offer",
    customer_type: "custom",
    server_only: false,
    stackable: false,
    prices: {
      yearly: { USD: "10000" },
    },
    included_items: {},
  } as const;
  await serverApp.grantProduct({ customCustomerId, product: inlineCustomProduct, quantity: 1 });

  const customProducts = await clientApp.listProducts({ customCustomerId });
  expect(customProducts).toHaveLength(1);
  expect(customProducts[0].displayName).toBe(inlineCustomProduct.display_name);
});

it("revokes products via root-level server SDK helpers", { timeout: 60_000 }, async ({ expect }) => {
  const { clientApp, serverApp } = await setupCustomerProductsScenario();

  await clientApp.signUpWithCredential({
    email: "revoke@example.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "revoke@example.com",
    password: "password",
  });

  const user = await clientApp.getUser();
  if (!user) throw new Error("User not found");

  await serverApp.grantProduct({ userId: user.id, productId: "test-offer" });
  const team = await user.createTeam({ displayName: "Revoke Team" });
  await serverApp.grantProduct({ teamId: team.id, productId: "team-offer" });
  const customCustomerId = "custom-revoke-id";
  await serverApp.grantProduct({ customCustomerId, productId: "custom-offer" });

  await serverApp.revokeProduct({ userId: user.id, productId: "test-offer" });
  expect(await serverApp.listProducts({ userId: user.id })).toHaveLength(0);

  await serverApp.revokeProduct({ teamId: team.id, productId: "team-offer" });
  expect(await serverApp.listProducts({ teamId: team.id })).toHaveLength(0);
  expect(await clientApp.listProducts({ teamId: team.id })).toHaveLength(0);

  await serverApp.revokeProduct({ customCustomerId, productId: "custom-offer" });
  expect(await clientApp.listProducts({ customCustomerId })).toHaveLength(0);
});

it("revokes products via customer-bound helpers", { timeout: 60_000 }, async ({ expect }) => {
  const { clientApp, serverApp } = await setupCustomerProductsScenario();

  await clientApp.signUpWithCredential({
    email: "customer-revoke@example.com",
    password: "password",
    verificationCallbackUrl: "http://localhost:3000",
  });
  await clientApp.signInWithCredential({
    email: "customer-revoke@example.com",
    password: "password",
  });

  const user = await clientApp.getUser();
  if (!user) throw new Error("User not found");

  await serverApp.grantProduct({ userId: user.id, productId: "test-offer" });
  const serverUser = await serverApp.getUser(user.id);
  if (!serverUser) throw new Error("Server user not found");

  await serverUser.revokeProduct({ productId: "test-offer" });
  expect(await serverApp.listProducts({ userId: user.id })).toHaveLength(0);

  const team = await user.createTeam({ displayName: "Customer Revoke Team" });
  await serverApp.grantProduct({ teamId: team.id, productId: "team-offer" });

  const serverTeam = await serverApp.getTeam(team.id);
  if (!serverTeam) {
    throw new Error("Server team not found");
  }
  await serverTeam.revokeProduct({ productId: "team-offer" });
  expect(await serverApp.listProducts({ teamId: team.id })).toHaveLength(0);
});
