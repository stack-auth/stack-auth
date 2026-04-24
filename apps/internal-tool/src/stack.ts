import { StackClientApp } from "@stackframe/stack";
import { envOrDevDefault } from "./lib/env";

const portPrefix = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81";

const projectId = envOrDevDefault(process.env.NEXT_PUBLIC_STACK_PROJECT_ID, "internal", "NEXT_PUBLIC_STACK_PROJECT_ID");
const publishableClientKey = envOrDevDefault(
  process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  "this-publishable-client-key-is-for-local-development-only",
  "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY",
);
const apiUrl = envOrDevDefault(process.env.NEXT_PUBLIC_STACK_API_URL, `http://localhost:${portPrefix}02`, "NEXT_PUBLIC_STACK_API_URL");

export const stackClientApp = new StackClientApp({
  projectId,
  publishableClientKey,
  tokenStore: "cookie",
  redirectMethod: "window",
  baseUrl: apiUrl,
  urls: {
    handler: "/handler",
    afterSignIn: "/",
    afterSignUp: "/",
    afterSignOut: "/handler/sign-in",
  },
});
