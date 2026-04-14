import { StackClientApp } from "@stackframe/stack";

const IS_DEV = process.env.NODE_ENV === "development";
const PLACEHOLDER = "REPLACE_ME";

// In dev, fall back to the seeded "internal" project if env vars are placeholders.
// In prod, the real values must be set via hosting platform env vars.
function envOrDevDefault(value: string | undefined, devDefault: string): string {
  if (!value || value === PLACEHOLDER) {
    if (IS_DEV) return devDefault;
    throw new Error("Stack Auth env var is not configured. Set the NEXT_PUBLIC_STACK_* vars in .env.local or hosting platform env.");
  }
  return value;
}

const portPrefix = process.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81";

const projectId = envOrDevDefault(process.env.NEXT_PUBLIC_STACK_PROJECT_ID, "internal");
const publishableClientKey = envOrDevDefault(
  process.env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
  "this-publishable-client-key-is-for-local-development-only",
);
const apiUrl = envOrDevDefault(process.env.NEXT_PUBLIC_STACK_API_URL, `http://localhost:${portPrefix}02`);

export const stackClientApp = new StackClientApp({
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
