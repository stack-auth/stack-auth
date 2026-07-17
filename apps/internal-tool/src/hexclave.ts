import { HexclaveClientApp } from "@hexclave/next";
import { envOrDevDefault, publicEnv } from "./lib/env";

const portPrefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";

const projectId = envOrDevDefault(
  publicEnv("NEXT_PUBLIC_HEXCLAVE_PROJECT_ID", "NEXT_PUBLIC_STACK_PROJECT_ID"),
  "internal",
  "NEXT_PUBLIC_HEXCLAVE_PROJECT_ID",
);
const publishableClientKey = envOrDevDefault(
  publicEnv("NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY", "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"),
  "this-publishable-client-key-is-for-local-development-only",
  "NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY",
);
const apiUrl = envOrDevDefault(
  publicEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "NEXT_PUBLIC_STACK_API_URL"),
  `http://localhost:${portPrefix}02`,
  "NEXT_PUBLIC_HEXCLAVE_API_URL",
);

export const hexclaveClientApp = new HexclaveClientApp({
  projectId,
  publishableClientKey,
  tokenStore: "cookie",
  redirectMethod: "window",
  baseUrl: apiUrl,
  urls: {
    handler: "/handler",
    afterSignIn: "/",
    afterSignUp: "/",
    afterSignOut: "/handler/sign-in",
  },
});
