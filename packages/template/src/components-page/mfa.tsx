"use client";

import { KnownErrors } from "@stackframe/stack-shared";
import {
  Button,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Spinner,
  Typography,
  cn,
} from "@stackframe/stack-ui";
import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStackApp } from "..";
import { FormWarningText } from "../components/elements/form-warning";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { useTranslation } from "../lib/translations";

function MfaForm({ onSuccess, onCancel }: {
  onSuccess?: () => void,
  onCancel?: () => void,
}) {
  const stackApp = useStackApp();
  const { t } = useTranslation();
  const [otp, setOtp] = useState<string>("");
  const formRef = useRef<HTMLFormElement>(null);

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState<boolean>(false);

  const [attemptCode, setAttemptCode] = useState<string | null>(null);

  useEffect(() => {
    if (!attemptCode && typeof window !== "undefined") {
      const code = window.sessionStorage.getItem("stack_mfa_attempt_code");
      if (code) {
        setAttemptCode(code);
      }
    }
  }, [ attemptCode]);

  // Handle OTP verification when code is complete
  useEffect(() => {
    if (otp.length === 6 && !submitting) {
      // Blur any focused inputs
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      if (formRef.current) {
        const inputs = formRef.current.querySelectorAll('input');
        for (const input of inputs) {
          input.blur();
        }
      }

      setSubmitting(true);
      setError(null);

      if (attemptCode) {
        stackApp
          .signInWithMfa(otp, attemptCode, { noRedirect: true })
          .then(async (result) => {
            if (result.status === "ok") {
              setVerified(true);

              // Cleanup session storage
              if (typeof window !== "undefined") {
                window.sessionStorage.removeItem("stack_mfa_attempt_code");
              }

              if (onSuccess) {
                onSuccess();
              } else {
                await stackApp.redirectToAfterSignIn();
              }
            } else {
              throw result.error;
            }
          })
          .catch((e) => {
            if (e instanceof KnownErrors.InvalidTotpCode) {
              setError(t("Invalid TOTP code"));
            } else {
              setError(t("Verification failed"));
            }
          })
          .finally(() => {
            setSubmitting(false);
            if (!verified) {
              setOtp("");
            }
          });
      } else {
        setSubmitting(false);
        setError(t("Missing verification information"));
      }
    }

    // Clear error when user is typing
    if (otp.length !== 0 && otp.length !== 6) {
      setError(null);
    }
  }, [otp, submitting, onSuccess, attemptCode, stackApp, t, verified]);


  const inputStyleClass = useMemo(() => {
    if (verified) {
      return "opacity-85 transition-all duration-300";
    }

    if (error) {
      return "ring-red-500 border-red-500";
    }

    return "focus:ring-primary/50";
  }, [error, verified]);

  return (
    <div className="flex flex-col items-stretch stack-scope">
      <form ref={formRef} className="w-full flex flex-col items-center gap-4">
        <InputOTP
          maxLength={6}
          type="text"
          inputMode="numeric"
          placeholder="······"
          value={otp}
          onChange={(value) => setOtp(value.toUpperCase())}
          disabled={submitting || verified}
        >
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <InputOTPSlot
                key={index}
                index={index}
                size="lg"
                className={cn(
                  "border focus:ring-2 transition-all",
                  inputStyleClass,
                )}
              />
            ))}
          </InputOTPGroup>
        </InputOTP>

        {/* Verification Status */}
        <div className="h-8 flex flex-col gap-4 items-center justify-center w-full">
          {verified ? (
            <div className="flex items-center gap-2 animate-in fade-in duration-300 slide-in-from-bottom-2">
              <CheckIcon className="w-5 h-5 text-green-600 animate-in zoom-in duration-300" />
              <Typography className="text-sm font-medium">{t("Verified! Redirecting...")}</Typography>
            </div>
          ) : submitting ? (
            <div className="flex items-center gap-2">
              <Spinner className="text-primary h-4 w-4" />
              <Typography className="text-sm">{t("Verifying...")}</Typography>
            </div>
          ) : null}

          {/* Error reporting */}
          {error !== null && !submitting && !verified ? <FormWarningText text={error} /> : null}
        </div>
      </form>

      {/* Cancel Button */}
      {onCancel && !verified && (
        <Button
          variant="link"
          onClick={onCancel}
          className="underline mt-4 self-center"
          disabled={submitting || verified}
        >
          {t("Cancel")}
        </Button>
      )}
    </div>
  );
}

export function MFA(props: {
  fullPage?: boolean,
  onSuccess?: () => void,
  onCancel?: () => void,
}) {
  const { t } = useTranslation();

  const headerText = t("Multi-Factor Authentication");
  const instructionText = t("Enter the six-digit code from your authenticator app");

  if (props.fullPage) {
    return (
      <MaybeFullPage fullPage={true}>
        <div
          className="stack-scope flex flex-col items-stretch"
          style={{ maxWidth: "380px", flexBasis: "380px", padding: "1rem" }}
        >
          <div className="text-center mb-6">
            <Typography type="h2">{headerText}</Typography>
            <Typography className="mt-2">{instructionText}</Typography>
          </div>
          <MfaForm onSuccess={props.onSuccess} onCancel={props.onCancel} />
        </div>
      </MaybeFullPage>
    );
  }

  return (
    <div className="flex flex-col items-stretch stack-scope">
      <Typography className="mb-4 text-center">{instructionText}</Typography>
      <MfaForm onSuccess={props.onSuccess} onCancel={props.onCancel} />
    </div>
  );
}
