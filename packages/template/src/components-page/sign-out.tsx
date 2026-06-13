'use client';

import { cacheFunction } from "@hexclave/shared/dist/utils/caches";
import { use } from "@hexclave/shared/dist/utils/react";
import { CurrentUser, useUser } from "..";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";

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
  const user = useUser({ or: "return-null" });
  const redirectUrl = props.searchParams?.after_auth_return_to;

  if (user) {
    use(cacheSignOut(user, redirectUrl));
  } else {
    use(cacheRedirectIfAlreadySignedOut(redirectUrl));
  }

  return <PredefinedMessageCard type='signedOut' fullPage={props.fullPage} />;
}
