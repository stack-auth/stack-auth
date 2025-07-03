"use client";

import { KnownErrors } from "@stackframe/stack-shared";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { Typography } from "@stackframe/stack-ui";
import { useStackApp } from "..";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { OTPCodeForm } from "../components/elements/otp-code-form";
import { useTranslation } from "../lib/translations";


export function EmailVerificationRequired(props: { fullPage?: boolean }) {
  const { t } = useTranslation();
  const stackApp = useStackApp();

  const headerText = t("Verify your email to continue");
  const instructionText = t("Enter the six-digit code sent to your email");

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
          type="email-verification-required"
          onSubmit={async (options) => {
            try {
              const result = await stackApp.verifyEmail(options.code + options.attemptCode);
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
