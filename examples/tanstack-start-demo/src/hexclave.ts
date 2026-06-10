import { HexclaveClientApp } from "@hexclave/tanstack-start";

function getPortPrefix(): string {
  return import.meta.env.NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX ?? "81";
}

function replaceHexclavePortPrefix(value: string): string {
  return value.replace(/\$\{NEXT_PUBLIC_HEXCLAVE_PORT_PREFIX:-81\}/g, getPortPrefix());
}

function getStackApiUrl(): string {
  const configured = import.meta.env.VITE_STACK_API_URL as string | undefined;
  return configured ? replaceHexclavePortPrefix(configured) : `http://localhost:${getPortPrefix()}02`;
}

export function createStackApp() {
  return new HexclaveClientApp({
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
