import type { StackClientAppConstructorOptions, StackServerAppConstructorOptions } from '@stackframe/js';
import { AdminProjectCreateOptions, StackAdminApp, StackClientApp, StackServerApp } from '@stackframe/js';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import { Result } from '@stackframe/stack-shared/dist/utils/results';
import { STACK_BACKEND_BASE_URL, STACK_INTERNAL_PROJECT_ADMIN_KEY, STACK_INTERNAL_PROJECT_CLIENT_KEY, STACK_INTERNAL_PROJECT_SERVER_KEY } from '../helpers';

export async function scaffoldProject(body?: Omit<AdminProjectCreateOptions, 'displayName' | 'teamId'> & { displayName?: string }) {
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
    verificationCallbackUrl: "http://localhost:3000",
  }));
  const adminUser = await internalApp.getUser({
    or: 'throw',
  });
  const teamId = adminUser.selectedTeam?.id ?? throwErr("No team selected");

  const project = await adminUser.createProject({
    displayName: body?.displayName || 'New Project',
    teamId,
    ...body,
  });

  return {
    project,
    adminUser,
  };
}

export async function createApp(
  body?: Parameters<typeof scaffoldProject>[0],
  appOverrides?: {
    client?: Partial<StackClientAppConstructorOptions<true, string>>,
    server?: Partial<StackServerAppConstructorOptions<true, string>>,
  },
) {
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
    ...(appOverrides?.server ?? {}),
  });

  const clientApp = new StackClientApp({
    baseUrl: STACK_BACKEND_BASE_URL,
    projectId: project.id,
    publishableClientKey: apiKey.publishableClientKey,
    tokenStore: "memory",
    ...(appOverrides?.client ?? {}),
  });

  return {
    serverApp,
    clientApp,
    adminApp,
  };
}
