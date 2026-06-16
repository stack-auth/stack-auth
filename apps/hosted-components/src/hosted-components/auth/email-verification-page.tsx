import { KnownErrors } from "@hexclave/shared";
import { useStackApp } from "@hexclave/react";
import { useState } from "react";

import { HostedAuthMessage } from "./supporting/layout";
import { getSearchParams } from "./supporting/utils";

export function HostedEmailVerification(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const searchParams = getSearchParams();
  const code = searchParams.code;
  const [result, setResult] = useState<Awaited<ReturnType<typeof app.verifyEmail>> | null>(null);

  const invalid = (
    <HostedAuthMessage
      title="Invalid verification link"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      This verification link is invalid. Please check the link or request a new verification email.
    </HostedAuthMessage>
  );

  if (code == null) {
    return invalid;
  }

  if (result == null) {
    return (
      <HostedAuthMessage
        title="Verify your email"
        primaryText="Verify email"
        primaryAction={async () => {
          setResult(await app.verifyEmail(code));
        }}
        secondaryText="Cancel"
        secondaryAction={() => app.redirectToHome()}
        fullPage={props.fullPage}
      >
        Confirm that you want to verify this email address for your account.
      </HostedAuthMessage>
    );
  }

  if (result.status === "error") {
    if (KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
      return (
        <HostedAuthMessage
          title="Verification link expired"
          primaryAction={() => app.redirectToHome()}
          primaryText="Go home"
          fullPage={props.fullPage}
        >
          This verification link has expired. Please request a new verification email from your account settings.
        </HostedAuthMessage>
      );
    }
    if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
      return (
        <HostedAuthMessage
          title="Email already verified"
          primaryAction={() => app.redirectToHome()}
          primaryText="Go home"
          fullPage={props.fullPage}
        >
          This verification link has already been used, so your email is already verified.
        </HostedAuthMessage>
      );
    }
    if (KnownErrors.VerificationCodeNotFound.isInstance(result.error)) {
      return invalid;
    }
    throw result.error;
  }

  return (
    <HostedAuthMessage
      title="Email verified"
      primaryAction={() => app.redirectToHome()}
      primaryText="Go home"
      fullPage={props.fullPage}
    >
      Your email has been verified. You can continue using your account.
    </HostedAuthMessage>
  );
}
