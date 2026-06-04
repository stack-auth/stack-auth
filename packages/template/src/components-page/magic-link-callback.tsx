'use client';

import { KnownErrors } from "@hexclave/shared";
import { cacheFunction } from "@hexclave/shared/dist/utils/caches";
import { throwErr } from "@hexclave/shared/dist/utils/errors";
import React from "react";
import { StackClientApp, useStackApp, useUser } from "..";
import { MessageCard } from "../components/message-cards/message-card";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { useTranslation } from "../lib/translations";

const cacheSignInWithMagicLink = cacheFunction(async (hexclaveApp: StackClientApp<true>, code: string) => {
  return await hexclaveApp.signInWithMagicLink(code);
});

export function MagicLinkCallback(props: {
  searchParams?: Record<string, string>,
  fullPage?: boolean,
}) {
  const { t } = useTranslation();
  const hexclaveApp = useStackApp();
  const user = useUser();
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof hexclaveApp.signInWithMagicLink>> | null>(null);

  if (user) {
    return <PredefinedMessageCard type='signedIn' fullPage={!!props.fullPage} />;
  }

  const invalidJsx = (
    <MessageCard title={t("Invalid Magic Link")} fullPage={!!props.fullPage}>
      <p>{t("Please check if you have the correct link. If you continue to have issues, please contact support.")}</p>
    </MessageCard>
  );

  const expiredJsx = (
    <MessageCard title={t("Expired Magic Link")} fullPage={!!props.fullPage}>
      <p>{t("Your magic link has expired. Please request a new magic link if you need to sign-in.")}</p>
    </MessageCard>
  );

  const alreadyUsedJsx = (
    <MessageCard title={t("Magic Link Already Used")} fullPage={!!props.fullPage}>
      <p>{t("The magic link has already been used. The link can only be used once. Please request a new magic link if you need to sign-in again.")}</p>
    </MessageCard>
  );

  if (!props.searchParams?.code) {
    return invalidJsx;
  }

  if (!result) {
    return <MessageCard
      title={t("Do you want to sign in?")}
      fullPage={!!props.fullPage}
      primaryButtonText={t("Sign in")}
      primaryAction={async () => {
        const result = await hexclaveApp.signInWithMagicLink(props.searchParams?.code || throwErr("No magic link provided"));
        setResult(result);
      }}
      secondaryButtonText={t("Cancel")}
      secondaryAction={async () => {
        await hexclaveApp.redirectToHome();
      }}
    />;
  } else {
    if (result.status === 'error') {
      if (KnownErrors.VerificationCodeNotFound.isInstance(result.error)) {
        return invalidJsx;
      } else if (KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
        return expiredJsx;
      } else if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
        return alreadyUsedJsx;
      } else {
        throw result.error;
      }
    }

    return <MessageCard
      title={t("Signed in successfully!")}
      fullPage={!!props.fullPage}
      primaryButtonText={t("Go home")}
      primaryAction={async () => {
        await hexclaveApp.redirectToHome();
      }}
    />;
  }
}
