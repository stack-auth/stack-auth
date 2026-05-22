import { stackAppInternalsSymbol } from "@/lib/stack-app-internals";
import { HexclaveAssertionError } from "@stackframe/stack-shared/dist/utils/errors";

export function buildTransferSignUpUrl(): string {
  const currentUrl = new URL(window.location.href);
  const signUpUrl = new URL("/handler/signup", window.location.origin);
  signUpUrl.searchParams.set(
    "after_auth_return_to",
    currentUrl.pathname + currentUrl.search + currentUrl.hash,
  );
  return signUpUrl.pathname + signUpUrl.search;
}

type StackAppInternals = {
  sendRequest: (
    path: string,
    requestOptions: RequestInit,
    requestType?: "client" | "server" | "admin",
  ) => Promise<Response>,
};

export function getStackAppInternals(app: unknown): StackAppInternals {
  if (typeof app !== "object" || app === null) {
    throw new HexclaveAssertionError("getStackAppInternals: expected an app object", { app });
  }
  const internals = (app as Record<symbol, unknown>)[stackAppInternalsSymbol];
  if (internals == null || typeof (internals as StackAppInternals).sendRequest !== "function") {
    throw new HexclaveAssertionError("getStackAppInternals: app is missing stackAppInternalsSymbol or sendRequest", { app });
  }
  return internals as StackAppInternals;
}
