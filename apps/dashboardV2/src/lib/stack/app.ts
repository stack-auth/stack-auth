import {
  STACK_API_URL,
  STACK_PROJECT_ID,
  STACK_PUBLISHABLE_CLIENT_KEY,
} from "@/lib/env"
import { StackClientApp } from "@stackframe/tanstack-start"

/**
 * Singleton StackClientApp for dashboardV2. Mirrors the legacy dashboard's
 * config — uses the default `/handler` URL for the SDK auth pages.
 */
export const stackApp = new StackClientApp({
  baseUrl: STACK_API_URL,
  projectId: STACK_PROJECT_ID,
  publishableClientKey: STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
  analytics: {
    replays: {
      enabled: true,
    }
  },
  urls: {
    afterSignIn: "/projects",
    afterSignUp: "/projects",
    afterSignOut: "/",
  },
})
