import { StackServerApp } from '@stackframe/stack';
import { getEnvVariable } from '@stackframe/stack-shared/dist/utils/env';

export const stackServerApp = new StackServerApp({
  projectId: 'internal',
  tokenStore: 'memory',
  baseUrl: getEnvVariable('NEXT_PUBLIC_STACK_API_URL'),
  publishableClientKey: getEnvVariable('STACK_SEED_INTERNAL_PROJECT_PUBLISHABLE_CLIENT_KEY'),
  secretServerKey: getEnvVariable('STACK_SEED_INTERNAL_PROJECT_SECRET_SERVER_KEY'),
});
