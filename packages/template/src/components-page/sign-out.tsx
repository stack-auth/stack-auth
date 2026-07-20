'use client';

import { cacheFunction } from "@hexclave/shared/dist/utils/caches";
import { captureError } from "@hexclave/shared/dist/utils/errors";
import { use } from "@hexclave/shared/dist/utils/react";
import { CurrentUser, useStackApp, useUser } from "..";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { StackClientApp, hexclaveAppInternalsSymbol } from "../lib/hexclave-app";

// The sign-out page's `after_auth_return_to` comes straight from the query string, so it is
// attacker-craftable (open-redirect shaped). Only follow it if it passes the same trust validation
// as every other SDK redirect; otherwise ignore it and fall back to the default after-sign-out
// destination.
const cacheGetTrustedRedirectUrl = cacheFunction(async (app: StackClientApp<true, string>, redirectUrl: string | undefined): Promise<string | undefined> => {
  if (redirectUrl == null) {
    return undefined;
  }
  if (await app[hexclaveAppInternalsSymbol].isTrustedRedirectUrl(redirectUrl)) {
    return redirectUrl;
  }
  captureError("sign-out-untrusted-redirect-url", new Error(`Ignoring untrusted after_auth_return_to query parameter on the sign-out page: ${redirectUrl}`));
  return undefined;
});

const cacheSignOut = cacheFunction(async (user: CurrentUser, redirectUrl: string | undefined) => {
  return await user.signOut({ redirectUrl });
});

const cacheRedirectIfAlreadySignedOut = cacheFunction(async (redirectUrl: string | undefined) => {
  if (redirectUrl == null) {
    return;
  }
  if (typeof window !== "undefined") {
    window.location.replace(redirectUrl);
  }
});

export function SignOut(props: { fullPage?: boolean, searchParams?: Record<string, string> }) {
  const app = useStackApp();
  const user = useUser({ or: "return-null" });
  const redirectUrl = props.searchParams?.after_auth_return_to;
  const trustedRedirectUrl = use(cacheGetTrustedRedirectUrl(app, redirectUrl));

  if (user) {
    use(cacheSignOut(user, trustedRedirectUrl));
  } else {
    use(cacheRedirectIfAlreadySignedOut(trustedRedirectUrl));
  }

  return <PredefinedMessageCard type='signedOut' fullPage={props.fullPage} />;
}
