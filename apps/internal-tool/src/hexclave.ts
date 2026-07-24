import { HexclaveClientApp } from "@hexclave/next";
import { envOrDevDefault, hexclaveApiUrl } from "./lib/env";

const projectId = envOrDevDefault(
  process.env.NEXT_PUBLIC_HEXCLAVE_PROJECT_ID,
  "internal",
  "NEXT_PUBLIC_HEXCLAVE_PROJECT_ID",
);
const apiUrl = hexclaveApiUrl();

export const hexclaveClientApp = new HexclaveClientApp({
  projectId,
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
