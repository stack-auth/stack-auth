import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";

export function buildTransferSignUpUrl(): string {
  const currentUrl = new URL(window.location.href);
  const signUpSearchParams = new URLSearchParams();
  signUpSearchParams.set("after_auth_return_to", currentUrl.pathname + currentUrl.search + currentUrl.hash);
  return `/handler/signup?${signUpSearchParams.toString()}`;
}

type StackAppInternals = {
  sendRequest: (
    path: string,
    requestOptions: RequestInit,
    requestType?: "client" | "server" | "admin",
  ) => Promise<Response>,
};

export function getStackAppInternals(app: unknown): StackAppInternals {
  return (app as Record<symbol, StackAppInternals>)[stackAppInternalsSymbol];
}
