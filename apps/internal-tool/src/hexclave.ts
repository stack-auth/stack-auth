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

function createHexclaveClientApp() {
  const portPrefix = process.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";

  const projectId = envOrDevDefault(publicEnv("NEXT_PUBLIC_HEXCLAVE_PROJECT_ID", "NEXT_PUBLIC_STACK_PROJECT_ID"), "internal");
  const publishableClientKey = envOrDevDefault(
    publicEnv("NEXT_PUBLIC_HEXCLAVE_PUBLISHABLE_CLIENT_KEY", "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY"),
    "this-publishable-client-key-is-for-local-development-only",
  );
  const apiUrl = envOrDevDefault(publicEnv("NEXT_PUBLIC_HEXCLAVE_API_URL", "NEXT_PUBLIC_STACK_API_URL"), `http://localhost:${portPrefix}02`);

  return new StackClientApp({
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
}

// The config above comes from NEXT_PUBLIC_HEXCLAVE_* env vars that are injected at container startup
// via the sentinel-replacement model (the build bakes in REPLACE_ME placeholders). StackClientApp
// eagerly validates projectId as a UUID at construction, so building the app while the value is still
// the unreplaced sentinel throws. Construct lazily and only once, so it happens at first runtime use —
// on the client, after the real values are in place — and the routes stay statically prerenderable.
let cachedApp: ReturnType<typeof createHexclaveClientApp> | undefined;
export function getHexclaveClientApp() {
  return cachedApp ??= createHexclaveClientApp();
}
