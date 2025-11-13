import { StackAdminApp, StackClientApp, StackServerApp } from "@stackframe/js";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { isUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { STACK_BACKEND_BASE_URL, it } from "../helpers";
import { scaffoldProject } from "./js-helpers";

it("StackServerApp can inherit configuration from StackClientApp", async ({ expect }) => {
  const { project, adminUser } = await scaffoldProject();
  const adminApp = new StackAdminApp({
    projectId: project.id,
    baseUrl: STACK_BACKEND_BASE_URL,
    projectOwnerSession: adminUser._internalSession,
    tokenStore: "memory",
  });

  const key = await adminApp.createInternalApiKey({
    description: "inheritance test key",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    hasPublishableClientKey: true,
    hasSecretServerKey: true,
    hasSuperSecretAdminKey: true,
  });

  const clientApp = new StackClientApp({
    baseUrl: STACK_BACKEND_BASE_URL,
    projectId: project.id,
    publishableClientKey: key.publishableClientKey,
    tokenStore: "memory",
  });

  const serverApp = new StackServerApp({
    inheritsFrom: clientApp,
    secretServerKey: key.secretServerKey,
    tokenStore: "memory",
  });

  const createdUser = await serverApp.createUser({
    primaryEmail: `${crypto.randomUUID()}@inheritance-test.example.com`,
    password: "password",
    primaryEmailAuthEnabled: true,
  });

  expect(isUuid(createdUser.id)).toBe(true);
  const fetchedUser = await serverApp.getUser(createdUser.id);
  expect(fetchedUser?.id).toBe(createdUser.id);
});

it("StackAdminApp can inherit configuration from StackServerApp", async ({ expect }) => {
  const { project, adminUser } = await scaffoldProject();
  const adminApp = new StackAdminApp({
    projectId: project.id,
    baseUrl: STACK_BACKEND_BASE_URL,
    projectOwnerSession: adminUser._internalSession,
    tokenStore: "memory",
  });

  const key = await adminApp.createInternalApiKey({
    description: "admin inheritance key",
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
    hasPublishableClientKey: true,
    hasSecretServerKey: true,
    hasSuperSecretAdminKey: true,
  });

  const clientApp = new StackClientApp({
    baseUrl: STACK_BACKEND_BASE_URL,
    projectId: project.id,
    publishableClientKey: key.publishableClientKey,
    tokenStore: "memory",
  });

  const serverApp = new StackServerApp({
    inheritsFrom: clientApp,
    secretServerKey: key.secretServerKey ?? throwErr("secret server key missing"),
    tokenStore: "memory",
  });

  const adminInherited = new StackAdminApp({
    inheritsFrom: serverApp,
    superSecretAdminKey: key.superSecretAdminKey ?? throwErr("super secret admin key missing"),
    tokenStore: "memory",
  });

  const keys = await adminInherited.listInternalApiKeys();
  expect(Array.isArray(keys)).toBe(true);
  expect(adminInherited.projectId).toBe(project.id);
});
