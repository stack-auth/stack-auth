import { AdminProjectUpdateOptions, StackAdminApp, StackClientApp, StackServerApp } from '@stackframe/js';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { STACK_BACKEND_BASE_URL, STACK_INTERNAL_PROJECT_ADMIN_KEY, STACK_INTERNAL_PROJECT_CLIENT_KEY, STACK_INTERNAL_PROJECT_SERVER_KEY } from '../helpers';

export async function scaffoldProject(body?: AdminProjectUpdateOptions) {
  const internalApp = new StackAdminApp({
    projectId: 'internal',
    baseUrl: STACK_BACKEND_BASE_URL,
    publishableClientKey: STACK_INTERNAL_PROJECT_CLIENT_KEY,
    secretServerKey: STACK_INTERNAL_PROJECT_SERVER_KEY,
    superSecretAdminKey: STACK_INTERNAL_PROJECT_ADMIN_KEY,
    tokenStore: "memory",
  });

  const fakeEmail = `${crypto.randomUUID()}@stack-js-test.example.com`;

  Result.orThrow(await internalApp.signUpWithCredential({
    email: fakeEmail,
    password: "password",
    verificationCallbackUrl: "https://stack-js-test.example.com/verify",
  }));
  const adminUser = await internalApp.getUser({
    or: 'throw',
  });

  const project = await adminUser.createProject({
    displayName: body?.displayName || 'New Project',
    ...body,
  });

  return {
    project,
    adminUser,
  };
}

export async function createApp(body?: AdminProjectUpdateOptions) {
  const { project, adminUser } = await scaffoldProject(body);
  const adminApp = new StackAdminApp({
    projectId: project.id,
    baseUrl: STACK_BACKEND_BASE_URL,
    projectOwnerSession: adminUser._internalSession,
    tokenStore: "memory",
  });

  const apiKey = await adminApp.createInternalApiKey({
    description: 'test',
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
    hasPublishableClientKey: true,
    hasSecretServerKey: true,
    hasSuperSecretAdminKey: false,
  });

  const serverApp = new StackServerApp({
    baseUrl: STACK_BACKEND_BASE_URL,
    projectId: project.id,
    publishableClientKey: apiKey.publishableClientKey,
    secretServerKey: apiKey.secretServerKey,
    tokenStore: "memory",
  });

  const clientApp = new StackClientApp({
    baseUrl: STACK_BACKEND_BASE_URL,
    projectId: project.id,
    publishableClientKey: apiKey.publishableClientKey,
    tokenStore: "memory",
  });

  return {
    serverApp,
    clientApp,
    adminApp,
  };
}
