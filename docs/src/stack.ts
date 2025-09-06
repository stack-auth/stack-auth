import { StackServerApp } from '@stackframe/stack';
import "server-only";

// Explicitly configure Stack Auth for docs app
export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  secretServerKey: process.env.STACK_SECRET_SERVER_KEY,
  baseUrl: process.env.NEXT_PUBLIC_STACK_API_URL,
});
