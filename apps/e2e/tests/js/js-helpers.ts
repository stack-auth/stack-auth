import { AdminProjectUpdateOptions, StackAdminApp } from '@stackframe/js';
import { wait } from '@stackframe/stack-shared/dist/utils/promises';
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

  await internalApp.signUpWithCredential({
    email: fakeEmail,
    password: "password",
    verificationCallbackUrl: "https://stack-js-test.example.com/verify",
  });
  const internalUser = await internalApp.getUser({
    or: 'throw',
  });

  // TODO make createProject return an AdminOwnedProject so we won't have to list them right after
  const project = await internalUser.createProject({
    displayName: body?.displayName || 'New Project',
    ...body,
  });
  const [{ app: adminApp }] = await internalUser.listOwnedProjects();
  
  const publishableClientKey = ???;
  const secretServerKey = ???;
  
  const clientApp = new StackClientApp({
    projectId: projectId,
    baseUrl: STACK_BACKEND_BASE_URL,
    publishableClientKey: publishableClientKey,
    tokenStore: "memory",
  });

  const serverApp = new StackServerApp({
    projectId: projectId,
    baseUrl: STACK_BACKEND_BASE_URL,
    publishableClientKey: publishableClientKey,
    secretServerKey: secretServerKey,
    tokenStore: "memory",
  });


  return {
    project,
    user,
    clientApp,
    serverApp,
    adminApp,
  };
}
