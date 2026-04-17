import { getPublicEnvVar } from "@/lib/env";
import { StackServerApp } from '@stackframe/stack';
import { throwErr } from '@stackframe/stack-shared/dist/utils/errors';
import './polyfills';

if (getPublicEnvVar("NEXT_PUBLIC_STACK_PROJECT_ID") !== "internal") {
  throw new Error("This project is not configured correctly. stack-dashboard must always use the internal project.");
}

const isPreview = getPublicEnvVar("NEXT_PUBLIC_STACK_IS_PREVIEW") === "true";

export const stackServerApp = new StackServerApp({
  baseUrl: {
    browser: getPublicEnvVar("NEXT_PUBLIC_BROWSER_STACK_API_URL") ?? getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_BROWSER_STACK_API_URL is not set"),
    server: getPublicEnvVar("NEXT_PUBLIC_SERVER_STACK_API_URL") ?? getPublicEnvVar("NEXT_PUBLIC_STACK_API_URL") ?? throwErr("NEXT_PUBLIC_SERVER_STACK_API_URL is not set"),
  },
  projectId: "internal",
  publishableClientKey: getPublicEnvVar("NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"),
  tokenStore: isPreview ? "memory" : "nextjs-cookie",
  urls: {
    afterSignIn: "/projects",
    afterSignUp: "/new-project",
    afterSignOut: "/",
  },
  analytics: {
    replays: {
      maskAllInputs: false,
      enabled: !isPreview,
    },
  },
});
