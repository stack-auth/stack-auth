import { StackClientApp } from "@stackframe/tanstack-start";

function getPortPrefix(): string {
  return import.meta.env.NEXT_PUBLIC_STACK_PORT_PREFIX ?? "81";
}

function replaceStackPortPrefix(value: string): string {
  return value.replace(/\$\{NEXT_PUBLIC_STACK_PORT_PREFIX:-81\}/g, getPortPrefix());
}

function getStackApiUrl(): string {
  const configured = import.meta.env.VITE_STACK_API_URL as string | undefined;
  return configured ? replaceStackPortPrefix(configured) : `http://localhost:${getPortPrefix()}02`;
}

export function createStackApp() {
  return new StackClientApp({
    projectId: import.meta.env.VITE_STACK_PROJECT_ID ?? "internal",
    publishableClientKey: import.meta.env.VITE_STACK_PUBLISHABLE_CLIENT_KEY ?? "this-publishable-client-key-is-for-local-development-only",
    baseUrl: getStackApiUrl(),
    tokenStore: "cookie",
    redirectMethod: "window",
    urls: {
      afterSignIn: "/protected",
      afterSignUp: "/protected",
      afterSignOut: "/",
    },
  });
}
