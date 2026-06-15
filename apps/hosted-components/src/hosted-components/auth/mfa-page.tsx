import { KnownErrors } from "@hexclave/shared";
import { useStackApp } from "@hexclave/react";
import { runAsynchronously } from "@hexclave/shared/dist/utils/promises";
import { Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  Button,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Spinner,
  Typography,
  cn,
} from "~/components/ui";

import { FormWarningText } from "./supporting/form-elements";
import { HostedAuthShell } from "./supporting/layout";

export function HostedMfa(props: {
  fullPage?: boolean,
  onSuccess?: () => void,
  onCancel?: () => void,
}) {
  const app = useStackApp();
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [attemptCode, setAttemptCode] = useState<string | null>(null);

  useEffect(() => {
    if (!attemptCode && typeof window !== "undefined") {
      const code = window.sessionStorage.getItem("hexclave_mfa_attempt_code") ?? window.sessionStorage.getItem("stack_mfa_attempt_code");
      if (code) {
        setAttemptCode(code);
      }
    }
  }, [attemptCode]);

  const submit = async (currentOtp: string) => {
    if (!attemptCode || currentOtp.length !== 6 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await app.signInWithMfa(currentOtp, attemptCode, { noRedirect: true });
      if (result.status === "ok") {
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem("hexclave_mfa_attempt_code");
          window.sessionStorage.removeItem("stack_mfa_attempt_code");
        }
        setVerified(true);
        if (props.onSuccess) {
          props.onSuccess();
        } else {
          await app.redirectToAfterSignIn();
        }
      } else if (KnownErrors.InvalidTotpCode.isInstance(result.error)) {
        setError("Invalid TOTP code");
        setOtp("");
      } else {
        setError("Verification failed");
      }
    } catch (e) {
      setError("Verification failed");
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyleClass = useMemo(() => {
    if (verified) {
      return "opacity-85 transition-all duration-300";
    }
    if (error) {
      return "ring-red-500 border-red-500 dark:ring-red-500 dark:border-red-500";
    }
    return "focus:ring-primary/50";
  }, [error, verified]);

  return (
    <HostedAuthShell fullPage={props.fullPage}>
      <div className="text-center mb-6">
        <Typography type="h2">Multi-Factor Authentication</Typography>
        <Typography className="mt-2 text-sm text-muted-foreground">
          Enter the six-digit code from your authenticator app
        </Typography>
      </div>

      <div className="flex flex-col items-center gap-4 stack-scope">
        <form
          className="w-full flex flex-col items-center gap-4"
          onSubmit={(e) => e.preventDefault()}
        >
          <InputOTP
            maxLength={6}
            type="text"
            inputMode="numeric"
            placeholder="······"
            value={otp}
            onChange={(value) => {
              const val = value.toUpperCase();
              setOtp(val);
              if (val.length === 6) {
                runAsynchronously(submit(val));
              } else {
                setError(null);
              }
            }}
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

          <div className="h-8 flex flex-col items-center justify-center w-full">
            {verified ? (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-500 animate-in fade-in duration-300 slide-in-from-bottom-2">
                <Check className="w-5 h-5 animate-in zoom-in duration-300" />
                <Typography className="text-sm font-medium">Verified! Redirecting...</Typography>
              </div>
            ) : submitting ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="h-4 w-4" />
                <Typography className="text-sm">Verifying...</Typography>
              </div>
            ) : null}

            {error !== null && !submitting && !verified ? (
              <FormWarningText text={error} />
            ) : null}
          </div>
        </form>
      </div>

      {props.onCancel && !verified && (
        <Button
          variant="link"
          onClick={props.onCancel}
          className="underline mt-4 self-center"
          disabled={submitting || verified}
        >
          Cancel
        </Button>
      )}
    </HostedAuthShell>
  );
}
