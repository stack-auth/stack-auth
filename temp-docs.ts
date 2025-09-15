import { getConvexProviderConfig } from "@stackframe/convex";
import { StackClientApp } from "@stackframe/stack";

export default {
  providers: [
    getConvexProviderConfig(),
  ],
};

export const stackClientApp = new StackClientApp({
  projectId: process.env.NEXT_PUBLIC_STACK_PROJECT_ID,
  publishableClientKey: process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "nextjs-cookie",
  integrations: {
    convex: {
      client: convexClient,
    },
  },
});
