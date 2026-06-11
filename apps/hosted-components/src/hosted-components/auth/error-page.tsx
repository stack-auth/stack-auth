import { KnownError, KnownErrors } from "@hexclave/shared";
import { useStackApp } from "@hexclave/react";

import { Typography } from "~/components/ui";

import { HostedAuthMessage } from "./supporting/layout";
import { getSearchParams } from "./supporting/utils";

export function HostedError(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const searchParams = getSearchParams();
  const errorCode = searchParams.errorCode;
  const message = searchParams.message;
  const details = searchParams.details;

  const unknownErrorCard = (
    <HostedAuthMessage
      title="An unknown error occurred"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      Something went wrong. Please try again or contact support.
    </HostedAuthMessage>
  );

  if (!errorCode || !message) {
    return unknownErrorCard;
  }

  let error: KnownError;
  try {
    const detailJson = details ? JSON.parse(details) : {};
    error = KnownError.fromJson({ code: errorCode, message, details: detailJson });
  } catch (e) {
    return unknownErrorCard;
  }

  if (KnownErrors.OAuthConnectionAlreadyConnectedToAnotherUser.isInstance(error)) {
    return (
      <HostedAuthMessage
        title="Failed to connect account"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        This account is already connected to another user. Please connect a different account.
      </HostedAuthMessage>
    );
  }

  if (KnownErrors.UserAlreadyConnectedToAnotherOAuthConnection.isInstance(error)) {
    return (
      <HostedAuthMessage
        title="Failed to connect account"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        fullPage={props.fullPage}
      >
        The user is already connected to another OAuth account. Did you maybe select the wrong account on the OAuth provider page?
      </HostedAuthMessage>
    );
  }

  if (KnownErrors.OAuthProviderAccessDenied.isInstance(error)) {
    return (
      <HostedAuthMessage
        title="OAuth provider access denied"
        primaryAction={() => app.redirectToSignIn()}
        primaryText="Sign in again"
        secondaryAction={() => app.redirectToHome()}
        secondaryText="Go home"
        fullPage={props.fullPage}
      >
        The sign-in operation has been cancelled or denied. Please try again.
      </HostedAuthMessage>
    );
  }

  if (KnownErrors.OAuthProviderTemporarilyUnavailable.isInstance(error)) {
    return (
      <HostedAuthMessage
        title="OAuth provider is temporarily unavailable"
        primaryAction={() => app.redirectToSignIn()}
        primaryText="Try again"
        secondaryAction={() => app.redirectToHome()}
        secondaryText="Go home"
        fullPage={props.fullPage}
      >
        The OAuth provider could not complete sign-in right now. Please try again in a moment.
      </HostedAuthMessage>
    );
  }

  return (
    <HostedAuthMessage
      title="An error occurred"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      <div className="flex flex-col gap-1 text-center">
        <Typography className="text-sm text-muted-foreground">Error Code: {error.errorCode}</Typography>
        <Typography className="text-sm text-muted-foreground">Please try again or contact support if the problem continues.</Typography>
      </div>
    </HostedAuthMessage>
  );
}
