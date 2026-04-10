import { StackClientApp } from "@stackframe/react";

const hostedComponentsUrl = process.env.NEXT_PUBLIC_STACK_HOSTED_COMPONENTS_URL;
const internalToolUrl = process.env.NEXT_PUBLIC_STACK_INTERNAL_TOOL_URL;

export const stackClientApp = new StackClientApp({
  projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
  redirectMethod: "window",
  baseUrl: process.env.NEXT_PUBLIC_STACK_API_URL,
  urls: {
    handler: `${hostedComponentsUrl}/handler`,
    signIn: `${hostedComponentsUrl}/handler/sign-in`,
    signUp: `${hostedComponentsUrl}/handler/sign-up`,
    afterSignIn: internalToolUrl,
    afterSignUp: internalToolUrl,
    afterSignOut: `${hostedComponentsUrl}/handler/sign-in`,
  },
});
