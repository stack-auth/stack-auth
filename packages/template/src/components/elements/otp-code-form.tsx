"use client";

import { Result } from "@stackframe/stack-shared/dist/utils/results";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Spinner,
  Typography,
  cn
} from "@stackframe/stack-ui";
import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useStackApp } from "../..";
import { useTranslation } from "../../lib/translations";
import { FormWarningText } from "./form-warning";

export function OTPCodeForm(props: {
  onSubmit: (options: { code: string, attemptCode: string }) => Promise<Result<void, string>>,
  type: "email-verification-required" | "mfa",
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
      const code = window.sessionStorage.getItem(`stack_${props.type}_attempt_code`);
      if (code) {
        setAttemptCode(code);
      } else {
        stackApp.redirectToSignIn().catch((e) => console.error(e));
      }
    }
  }, [ attemptCode ]);

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
        props.onSubmit({ code: otp, attemptCode })
          .then(async (result) => {
            if (result.status === "ok") {
              setVerified(true);

              // Cleanup session storage
              if (typeof window !== "undefined") {
                window.sessionStorage.removeItem(`stack_${props.type}_attempt_code`);
              }

              await stackApp.redirectToAfterSignIn();
            } else {
              setError(result.error);
            }
          })
          .catch((e) => {
            console.error(e);
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
  }, [otp, submitting, props.onSubmit, attemptCode, t, verified]);


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
    </div>
  );
}
