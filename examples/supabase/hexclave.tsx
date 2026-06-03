import "server-only";

import { StackServerApp } from "@hexclave/next";

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
});
