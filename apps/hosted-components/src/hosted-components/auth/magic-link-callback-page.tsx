import { KnownErrors } from "@hexclave/shared";
import { useStackApp, useUser } from "@hexclave/react";
import { useState } from "react";

import { HostedAuthMessage } from "./supporting/layout";
import { getSearchParams } from "./supporting/utils";

export function HostedMagicLinkCallback(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const user = useUser();
  const code = getSearchParams().code;
  const [cancelled, setCancelled] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof app.signInWithMagicLink>> | null>(null);

  if (user != null) {
    return (
      <HostedAuthMessage title="You're already signed in" fullPage={props.fullPage}>
        This magic link is no longer needed. You can close this tab.
      </HostedAuthMessage>
    );
  }

  const invalid = (
    <HostedAuthMessage title="Invalid magic link" fullPage={props.fullPage}>
      This magic link is invalid. Please request a new link if you still need to sign in. You can close this tab.
    </HostedAuthMessage>
  );

  if (code == null) {
    return invalid;
  }

  if (cancelled) {
    return (
      <HostedAuthMessage title="Sign-in cancelled" fullPage={props.fullPage}>
        The magic link was not used. You can close this tab.
      </HostedAuthMessage>
    );
  }

  if (result == null) {
    return (
      <HostedAuthMessage
        title="Do you want to sign in?"
        primaryText="Sign in"
        primaryAction={async () => {
          setResult(await app.signInWithMagicLink(code));
        }}
        secondaryText="Cancel"
        secondaryAction={() => setCancelled(true)}
        fullPage={props.fullPage}
      >
        Confirm that you want to use this magic link.
      </HostedAuthMessage>
    );
  }

  if (result.status === "error") {
    if (KnownErrors.VerificationCodeNotFound.isInstance(result.error)) {
      return invalid;
    }
    if (KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
      return (
        <HostedAuthMessage title="Expired magic link" fullPage={props.fullPage}>
          This magic link has expired. Please request a new link if you still need to sign in. You can close this tab.
        </HostedAuthMessage>
      );
    }
    if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
      return (
        <HostedAuthMessage title="Magic link already used" fullPage={props.fullPage}>
          This one-time magic link has already been used. You can close this tab.
        </HostedAuthMessage>
      );
    }
    throw result.error;
  }

  return (
    <HostedAuthMessage title="Signed in successfully" fullPage={props.fullPage}>
      You can close this tab.
    </HostedAuthMessage>
  );
}
