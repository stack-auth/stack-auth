/// <reference types="vite/client" />

import { StackClientApp } from "@stackframe/js";

export const stackClientApp = new StackClientApp({
  baseUrl: import.meta.env.VITE_STACK_API_URL,
  projectId: import.meta.env.VITE_STACK_PROJECT_ID,
  publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY,
  tokenStore: "cookie",
  urls: {
    oauthCallback: window.location.origin + "/oauth",
  },
}); 
