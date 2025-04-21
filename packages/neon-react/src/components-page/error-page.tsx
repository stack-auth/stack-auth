'use client';


//===========================================
// THIS FILE IS AUTO-GENERATED FROM TEMPLATE. DO NOT EDIT IT DIRECTLY
//===========================================

import { KnownError, KnownErrors } from "@stackframe/stack-shared";
import { Typography } from "@stackframe/stack-ui";
import { useStackApp } from "..";
import { KnownErrorMessageCard } from "../components/message-cards/known-error-message-card";
import { MessageCard } from "../components/message-cards/message-card";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { useTranslation } from "../lib/translations";


export function ErrorPage(props: { fullPage?: boolean, searchParams: Record<string, string> }) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const errorCode = props.searchParams.errorCode;
  const message = props.searchParams.message;
  const details = props.searchParams.details;

  const unknownErrorCard = <PredefinedMessageCard type='unknownError' fullPage={!!props.fullPage} />;

  if (!errorCode || !message) {
    return unknownErrorCard;
  }

  let error;
  try {
    const detailJson = details ? JSON.parse(details) : {};
    error = KnownError.fromJson({ code: errorCode, message, details: detailJson });
  } catch (e) {
    return unknownErrorCard;
  }

  if (error instanceof KnownErrors.OAuthConnectionAlreadyConnectedToAnotherUser) {
    // TODO: add "Connect a different account" button
    return (
      <MessageCard
        title={t("Failed to connect account")}
        fullPage={!!props.fullPage}
        primaryButtonText={t("Go Home")}
        primaryAction={() => stackApp.redirectToHome()}
      >
        <Typography>
          {t("This account is already connected to another user. Please connect a different account.")}
        </Typography>
      </MessageCard>
    );
  }

  if (error instanceof KnownErrors.UserAlreadyConnectedToAnotherOAuthConnection) {
    // TODO: add "Connect again" button
    return (
      <MessageCard
        title={t("Failed to connect account")}
        fullPage={!!props.fullPage}
        primaryButtonText={t("Go Home")}
        primaryAction={() => stackApp.redirectToHome()}
      >
        <Typography>
          {t("The user is already connected to another OAuth account. Did you maybe selected the wrong account on the OAuth provider page?")}
        </Typography>
      </MessageCard>
    );
  }

  if (error instanceof KnownErrors.OAuthProviderAccessDenied) {
    return (
      <MessageCard
        title={t("OAuth provider access denied")}
        fullPage={!!props.fullPage}
        primaryButtonText={t("Sign in again")}
        primaryAction={() => stackApp.redirectToSignIn()}
        secondaryButtonText={t("Go Home")}
        secondaryAction={() => stackApp.redirectToHome()}
      >
        <Typography>
          {t("The sign-in operation has been cancelled. Please try again. [access_denied]")}
        </Typography>
      </MessageCard>
    );
  }

  return <KnownErrorMessageCard error={error} fullPage={!!props.fullPage} />;
}
