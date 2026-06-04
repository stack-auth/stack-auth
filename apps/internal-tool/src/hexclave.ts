import { StackClientApp } from "@hexclave/next";

const IS_DEV = process.env.NODE_ENV === "development";
const PLACEHOLDER = "REPLACE_ME";

// In dev, fall back to the seeded "internal" project if env vars are placeholders.
// In prod, the real values must be set via hosting platform env vars.
function envOrDevDefault(value: string | undefined, devDefault: string): string {
  if (!value || value === PLACEHOLDER) {
    if (IS_DEV) return devDefault;
    throw new Error("Hexclave env var is not configured. Set the NEXT_PUBLIC_HEXCLAVE_* vars in .env.local or hosting platform env.");
  }
  return value;
}

function publicEnv(hexclaveName: string, legacyStackName: string): string | undefined {
  return process.env[hexclaveName] ?? process.env[legacyStackName];
}

const portPrefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";

const projectId = envOrDevDefault(publicEnv("NEXT_PUBLIC_HEXCLAVE_PROJECT_ID", "NEXT_PUBLIC_STACK_PROJECT_ID"), "internal");
const publishableClientKey = envOrDevDefault(
  publicEnv("NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY", "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"),
  "this-publishable-client-key-is-for-local-development-only",
);
const apiUrl = envOrDevDefault(publicEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "NEXT_PUBLIC_STACK_API_URL"), `http://localhost:${portPrefix}02`);

export const hexclaveClientApp = new StackClientApp({
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
