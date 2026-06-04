import "server-only";

import { StackServerApp } from "@hexclave/next";

export const hexclaveServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  urls: {
  }
});
