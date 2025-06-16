import { StackServerApp } from "@stackframe/stack";
import "server-only";
export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie", // storing auth tokens in cookies
});
