"use client";

import { KnownErrors } from "@stackframe/stack-shared";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { Typography } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import { useStackApp } from "..";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { OTPCodeForm } from "../components/elements/otp-code-form";
import { useTranslation } from "../lib/translations";


export function MFA(props: {
  fullPage?: boolean,
}) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const headerText = t("Multi-Factor Authentication");
  const instructionText = t("Enter the six-digit code from your authenticator app");
  const [attemptCode, setAttemptCode] = useState<string | null>(null);

  useEffect(() => {
    if (!attemptCode && typeof window !== "undefined") {
      const code = window.sessionStorage.getItem(`stack_mfa_attempt_code`);
      if (code) {
        setAttemptCode(code);
      } else {
        stackApp.redirectToSignIn().catch((e) => console.error(e));
      }
    }
  }, [attemptCode]);

  return (
    <MaybeFullPage fullPage={!!props.fullPage}>
      <div
        className="stack-scope flex flex-col items-stretch"
        style={props.fullPage ? { maxWidth: "380px", flexBasis: "380px", padding: "1rem" } : undefined}
      >
        {props.fullPage ? (
          <div className="text-center mb-6">
            <Typography type="h2">{headerText}</Typography>
            <Typography className="mt-2">{instructionText}</Typography>
          </div>
        ) : (
          <Typography className="mb-4 text-center">{instructionText}</Typography>
        )}
        <OTPCodeForm
          type="mfa"
          onSubmit={async (options) => {
            if (!attemptCode) {
              return Result.error(t("Missing verification information"));
            }

            try {
              const result = await stackApp.signInWithMfa(options.code, attemptCode, { noRedirect: true });
              if (result.status === "ok") {
                return Result.ok(undefined);
              }
              return Result.error(result.error.message);
            } catch (e) {
              if (KnownErrors.InvalidTotpCode.isInstance(e)) {
                return Result.error(t("Invalid TOTP code"));
              } else {
                console.error(e);
                return Result.error(t("Verification failed"));
              }
            }
          }}
        />
      </div>
    </MaybeFullPage>
  );
}
