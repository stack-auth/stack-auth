import { useStackApp, useUser } from "@hexclave/react";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useState } from "react";

import { Button, Input, Label } from "~/components/ui";

import { FormWarningText } from "./supporting/form-elements";
import {
  HostedAuthHeading,
  HostedAuthMessage,
  HostedAuthShell,
  authFooterClassName,
  authFooterLinkClassName,
} from "./supporting/layout";
import { isValidEmail } from "./supporting/utils";

export function HostedForgotPassword(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const user = useUser();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [sentEmail, setSentEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setEmailError(null);
    if (!isValidEmail(email)) {
      setEmailError("Please enter a valid email");
      return;
    }

    setLoading(true);
    try {
      await app.sendForgotPasswordEmail(email);
      setSentEmail(email);
    } finally {
      setLoading(false);
    }
  }

  if (user != null) {
    return (
      <HostedAuthMessage
        title="You're already signed in"
        primaryAction={() => app.redirectToHome()}
        primaryText="Go home"
        secondaryAction={() => app.redirectToSignOut()}
        secondaryText="Sign out"
        fullPage={props.fullPage}
      >
        You can continue to your account, or sign out before resetting another account's password.
      </HostedAuthMessage>
    );
  }

  if (sentEmail != null) {
    return (
      <HostedAuthMessage
        title="Check your email"
        primaryAction={() => app.redirectToSignIn()}
        primaryText="Back to sign in"
        secondaryAction={() => setSentEmail(null)}
        secondaryText="Use a different email"
        fullPage={props.fullPage}
      >
        If an account exists for this email, we sent password reset instructions to your inbox.
      </HostedAuthMessage>
    );
  }

  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <HostedAuthHeading title="Reset password">
        Enter your email and we'll send reset instructions.
      </HostedAuthHeading>

      <form
        className="stack-scope flex flex-col items-stretch"
        onSubmit={(event) => {
          event.preventDefault();
          runAsynchronouslyWithAlert(submit());
        }}
        noValidate
      >
        <Label htmlFor="email" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          className="h-10 rounded-xl border-border bg-background"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            setEmailError(null);
          }}
        />
        <FormWarningText text={emailError} />

        <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow" loading={loading}>
          Send reset email
        </Button>
      </form>

      <div className={authFooterClassName}>
        <p className="text-muted-foreground">
          Remembered your password?{" "}
          <a
            href={app.urls.signIn}
            className={authFooterLinkClassName}
            onClick={(event) => {
              event.preventDefault();
              runAsynchronously(app.redirectToSignIn());
            }}
          >
            Sign in
          </a>
        </p>
      </div>
    </HostedAuthShell>
  );
}
