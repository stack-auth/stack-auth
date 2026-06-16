import { StackServerApp } from '@hexclave/next';
import "server-only";
import { resolveInlineRenamedEnvVar } from './lib/env';

// Explicitly configure Stack Auth for docs app
export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  projectId: resolveInlineRenamedEnvVar("NEXT_PUBLIC_HEXCLAVE_PROJECT_ID", "NEXT_PUBLIC_STACK_PROJECT_ID", process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID, process.env.NEXT_PUBLIC_STACK_PROJECT_ID),
  publishableClientKey: resolveInlineRenamedEnvVar("NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY", "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY", process.env.NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY, process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY),
  secretServerKey: resolveInlineRenamedEnvVar("HEXCLAVE_SECRET_SERVER_KEY", "STACK_SECRET_SERVER_KEY", process.env.HEXCLAVE_SECRET_SERVER_KEY, process.env.STACK_SECRET_SERVER_KEY),
  baseUrl: resolveInlineRenamedEnvVar("NEXT_PUBLIC_HEXCLAVE_API_URL", "NEXT_PUBLIC_STACK_API_URL", process.env.NEXT_PUBLIC_HEXCLAVE_API_URL, process.env.NEXT_PUBLIC_STACK_API_URL),
  analytics: {
    replays: {
      enabled: true,
      maskAllInputs: false,
    },
  },
});
