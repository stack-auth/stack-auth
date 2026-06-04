import "server-only";

import { StackServerApp } from "@hexclave/next";

export const hexclaveServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  urls: {
    signIn: { type: "hosted" },
    signUp: { type: "custom", url: "/auth/sign-up", version: 0 },
    default: {
      "type": "hosted",
    },
  }
});
