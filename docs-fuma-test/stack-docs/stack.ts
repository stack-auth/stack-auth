import "server-only";
import { StackServerApp } from "../../packages/template/src";
export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie", // storing auth tokens in cookies
});
