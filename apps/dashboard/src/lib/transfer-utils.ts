import { hexclaveAppInternalsSymbol } from "@/lib/hexclave-app-internals";
import { HexclaveAssertionError } from "@hexclave/shared/dist/utils/errors";

export function buildTransferSignUpUrl(): string {
  const currentUrl = new URL(window.location.href);
  const signUpUrl = new URL("/handler/signup", window.location.origin);
  signUpUrl.searchParams.set(
    "after_auth_return_to",
    currentUrl.pathname + currentUrl.search + currentUrl.hash,
  );
  return signUpUrl.pathname + signUpUrl.search;
}

type HexclaveAppInternals = {
  sendRequest: (
    path: string,
    requestOptions: RequestInit,
    requestType?: "client" | "server" | "admin",
  ) => Promise<Response>,
};

export function getStackAppInternals(app: unknown): HexclaveAppInternals {
  if (typeof app !== "object" || app === null) {
    throw new HexclaveAssertionError("getStackAppInternals: expected an app object", { app });
  }
  const internals = (app as Record<symbol, unknown>)[hexclaveAppInternalsSymbol];
  if (internals == null || typeof (internals as HexclaveAppInternals).sendRequest !== "function") {
    throw new HexclaveAssertionError("getStackAppInternals: app is missing hexclaveAppInternalsSymbol or sendRequest", { app });
  }
  return internals as HexclaveAppInternals;
}
