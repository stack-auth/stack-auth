import "server-only";

import { StackServerApp } from "@stackframe/stack";

export const stackServerApp = new StackServerApp({
  tokenStore: "nextjs-cookie",
  urls: {
    accountSettings: '/settings',
    signIn: { type: "hosted" },
    signUp: { type: "custom", url: "/auth/sign-up", version: 0 },
    default: {
      "type": "handler-component",
    },
  }
});
