import { StackServerApp } from '@hexclave/next';
import "server-only";

// Explicitly configure Stack Auth for docs app
export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  projectId: process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID ?? process.env.NEXT_PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: process.env.NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY ?? process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.HEXCLAVE_SECRET_SERVER_KEY ?? process.env.STACK_SECRET_SERVER_KEY,
  baseUrl: process.env.NEXT_PUBLIC_HEXCLAVE_API_URL ?? process.env.NEXT_PUBLIC_STACK_API_URL,
  analytics: {
    replays: {
      enabled: true,
      maskAllInputs: false,
    },
  },
});
