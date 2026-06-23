import { KnownErrors } from "@hexclave/shared";
import { getPasswordError } from "@hexclave/shared/dist/helpers/password";
import { useStackApp } from "@hexclave/react";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useState } from "react";

import { Button, Label, PasswordInput } from "~/components/ui";

import { FormWarningText } from "./supporting/form-elements";
import {
  HostedAuthFallback,
  HostedAuthHeading,
  HostedAuthMessage,
  HostedAuthShell,
  authFooterClassName,
  authFooterLinkClassName,
} from "./supporting/layout";
import { getSearchParams } from "./supporting/utils";

export function HostedPasswordReset(props: {
  fullPage?: boolean,
}) {
  const app = useStackApp();
  const searchParams = getSearchParams();
  const code = searchParams.code;
  const [verificationState, setVerificationState] = useState<"checking" | "valid" | "invalid" | "expired" | "used">(code == null ? "invalid" : "checking");
  const [password, setPassword] = useState("");
  const [passwordRepeat, setPasswordRepeat] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordRepeatError, setPasswordRepeatError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [resetError, setResetError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (code == null) {
      return;
    }

    runAsynchronouslyWithAlert((async () => {
      const result = await app.verifyPasswordResetCode(code);
      if (result.status === "ok") {
        setVerificationState("valid");
      } else if (KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
        setVerificationState("expired");
      } else if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
        setVerificationState("used");
      } else {
        setVerificationState("invalid");
      }
    })());
  }, [app, code]);

  async function submit() {
    if (code == null) {
      setResetError(true);
      return;
    }

    setPasswordError(null);
    setPasswordRepeatError(null);
    if (password.length === 0) {
      setPasswordError("Please enter your password");
      return;
    }
    const passwordValidationError = getPasswordError(password);
    if (passwordValidationError != null) {
      setPasswordError(passwordValidationError.message);
      return;
    }
    if (passwordRepeat !== password) {
      setPasswordRepeatError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const result = await app.resetPassword({ password, code });
      if (result.status === "error") {
        setResetError(true);
        return;
      }
      setFinished(true);
    } finally {
      setLoading(false);
    }
  }

  if (verificationState === "checking") {
    return <HostedAuthFallback fullPage={props.fullPage} />;
  }

  if (verificationState === "invalid") {
    return (
      <HostedAuthMessage
        title="Invalid reset link"
        primaryAction={() => app.redirectToForgotPassword()}
        primaryText="Request a new link"
        secondaryAction={() => app.redirectToSignIn({ noRedirectBack: true })}
        secondaryText="Back to sign in"
        fullPage={props.fullPage}
      >
        This password reset link is invalid. Please request a new link from the forgot password page.
      </HostedAuthMessage>
    );
  }

  if (verificationState === "expired") {
    return (
      <HostedAuthMessage
        title="Reset link expired"
        primaryAction={() => app.redirectToForgotPassword()}
        primaryText="Request a new link"
        secondaryAction={() => app.redirectToSignIn({ noRedirectBack: true })}
        secondaryText="Back to sign in"
        fullPage={props.fullPage}
      >
        This password reset link has expired. Please request a new link and try again.
      </HostedAuthMessage>
    );
  }

  if (verificationState === "used") {
    return (
      <HostedAuthMessage
        title="Reset link already used"
        primaryAction={() => app.redirectToForgotPassword()}
        primaryText="Request a new link"
        secondaryAction={() => app.redirectToSignIn({ noRedirectBack: true })}
        secondaryText="Back to sign in"
        fullPage={props.fullPage}
      >
        This password reset link has already been used. Request a new link if you still need to reset your password.
      </HostedAuthMessage>
    );
  }

  if (finished) {
    return (
      <HostedAuthMessage
        title="Password reset"
        primaryAction={() => app.redirectToSignIn({ noRedirectBack: true })}
        primaryText="Sign in"
        fullPage={props.fullPage}
      >
        Your password has been reset. You can now sign in with your new password.
      </HostedAuthMessage>
    );
  }

  if (resetError) {
    return (
      <HostedAuthMessage
        title="Failed to reset password"
        primaryAction={() => app.redirectToForgotPassword()}
        primaryText="Request a new link"
        secondaryAction={() => app.redirectToSignIn({ noRedirectBack: true })}
        secondaryText="Back to sign in"
        fullPage={props.fullPage}
      >
        This reset link could not be used. Please request a new password reset link and try again.
      </HostedAuthMessage>
    );
  }

  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <HostedAuthHeading title="Reset password">
        Choose a new password for your account.
      </HostedAuthHeading>

      <form
        className="stack-scope flex flex-col items-stretch"
        onSubmit={(event) => {
          event.preventDefault();
          runAsynchronouslyWithAlert(submit());
        }}
        noValidate
      >
        <Label htmlFor="password" className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">New password</Label>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          className="h-10 rounded-xl border-border bg-background"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            setPasswordError(null);
            setPasswordRepeatError(null);
          }}
        />
        <FormWarningText text={passwordError} />

        <Label htmlFor="repeat-password" className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Repeat new password</Label>
        <PasswordInput
          id="repeat-password"
          autoComplete="new-password"
          className="h-10 rounded-xl border-border bg-background"
          value={passwordRepeat}
          onChange={(event) => {
            setPasswordRepeat(event.target.value);
            setPasswordError(null);
            setPasswordRepeatError(null);
          }}
        />
        <FormWarningText text={passwordRepeatError} />

        <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow" loading={loading}>
          Reset password
        </Button>
      </form>

      <div className={authFooterClassName}>
        <p className="text-muted-foreground">
          Remembered your password?{" "}
          <a
            href="#"
            className={authFooterLinkClassName}
            onClick={(event) => {
              event.preventDefault();
              runAsynchronously(app.redirectToSignIn({ noRedirectBack: true }));
            }}
          >
            Sign in
          </a>
        </p>
      </div>
    </HostedAuthShell>
  );
}
