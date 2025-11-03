/// <reference types="vite/client" />

import { StackClientApp } from "@stackframe/react";

export const stackClientApp = new StackClientApp({
  projectId: import.meta.env.VITE_STACK_PROJECT_ID,
  publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
  baseUrl: import.meta.env.VITE_STACK_API_URL,
  tokenStore: "chrome-extension-local",
});
