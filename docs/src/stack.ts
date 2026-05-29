import { StackServerApp } from '@hexclave/next';
import "server-only";

const placeholderPrefix = "#";
const replaceMePlaceholder = "REPLACE_ME";

function envOrUndefined(value: string | undefined): string | undefined {
  if (value == null || value === "" || value === replaceMePlaceholder || value.startsWith(placeholderPrefix)) {
    return undefined;
  }
  return value;
}

// Explicitly configure Stack Auth for docs app
export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  projectId: envOrUndefined(process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID) ?? envOrUndefined(process.env.NEXT_PUBLIC_STACK_PROJECT_ID) ?? "internal",
  publishableClientKey: envOrUndefined(process.env.NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY) ?? envOrUndefined(process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY),
  secretServerKey: envOrUndefined(process.env.HEXCLAVE_SECRET_SERVER_KEY) ?? envOrUndefined(process.env.STACK_SECRET_SERVER_KEY) ?? "this-secret-server-key-is-for-local-development-only",
  baseUrl: envOrUndefined(process.env.NEXT_PUBLIC_HEXCLAVE_API_URL) ?? envOrUndefined(process.env.NEXT_PUBLIC_STACK_API_URL),
  analytics: {
    replays: {
      enabled: true,
      maskAllInputs: false,
    },
  },
});
