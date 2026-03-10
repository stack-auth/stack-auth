'use client';

import { KnownErrors } from "@stackframe/stack-shared";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import React from "react";
import { useStackApp, useUser } from "..";
import { MessageCard } from "../components/message-cards/message-card";
import { useTranslation } from "../lib/translations";

export function EmailVerification(props: {
  searchParams?: Record<string, string>,
  fullPage?: boolean,
}) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const user = useUser();
  const [result, setResult] = React.useState<Awaited<ReturnType<typeof stackApp.verifyEmail>> | null>(null);

  const invalidJsx = (
    <MessageCard title={t("Invalid Verification Link")} fullPage={!!props.fullPage}>
      <p>{t("Please check if you have the correct link. If you continue to have issues, please contact support.")}</p>
    </MessageCard>
  );

  const expiredJsx = (
    <MessageCard title={t("Expired Verification Link")} fullPage={!!props.fullPage}>
      <p>{t("Your email verification link has expired. Please request a new verification link from your account settings.")}</p>
    </MessageCard>
  );

  if (!props.searchParams?.code) {
    return invalidJsx;
  }

  if (!result) {
    return <MessageCard
      title={t("Do you want to verify your email?")}
      fullPage={!!props.fullPage}
      primaryButtonText={t("Verify")}
      primaryAction={async () => {
        const result = await stackApp.verifyEmail(props.searchParams?.code || throwErr("No verification code provided"));
        setResult(result);
      }}
      secondaryButtonText={t("Cancel")}
      secondaryAction={async () => {
        await stackApp.redirectToHome();
      }}
    />;
  } else {
    if (result.status === 'error') {
      if (KnownErrors.VerificationCodeNotFound.isInstance(result.error)) {
        return invalidJsx;
      } else if (KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
        return expiredJsx;
      } else if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
        // everything fine, continue
      } else {
        throw result.error;
      }
    }

    return <MessageCard
      title={t("You email has been verified!")}
      fullPage={!!props.fullPage}
      primaryButtonText={t("Go home")}
      primaryAction={async () => {
        await stackApp.redirectToHome();
      }}
    />;
  }
}
