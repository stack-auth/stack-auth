import { StackServerApp } from '@stackframe/stack';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';

export function getStackServerApp() {
  return new StackServerApp({
    projectId: 'internal',
    tokenStore: null,
    baseUrl: getEnvVariable('NEXT_PUBLIC_STACK_API_URL'),
    publishableClientKey: getEnvVariable('STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY'),
    secretServerKey: getEnvVariable('STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY'),
  });
}
