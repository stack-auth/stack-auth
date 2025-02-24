import { StackClientApp } from "@stackframe/react";

export const stackClientApp = new StackClientApp({
  projectId: "stack-auth-example",
  publishableClientKey: "pk_test_1234567890",
  tokenStore: "cookie",
});
