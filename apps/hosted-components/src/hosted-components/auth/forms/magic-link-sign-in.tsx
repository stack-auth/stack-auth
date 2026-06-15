import { KnownErrors } from "@hexclave/shared";
import { useStackApp } from "@hexclave/react";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useEffect, useState } from "react";

import {
  Button,
  Input,
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  Label,
  Typography,
} from "~/components/ui";

import { FormWarningText } from "../supporting/form-elements";
import { isValidEmail } from "../supporting/utils";

function MagicLinkOtp(props: {
  nonce: string,
  onBack: () => void,
}) {
  const app = useStackApp();
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (otp.length !== 6 || submitting) {
      if (otp.length !== 0 && otp.length !== 6) {
        setError(null);
      }
      return;
    }

    setSubmitting(true);
    runAsynchronouslyWithAlert((async () => {
      try {
        const result = await app.signInWithMagicLink(otp + props.nonce);
        if (result.status === "error") {
          if (KnownErrors.VerificationCodeError.isInstance(result.error) || KnownErrors.InvalidTotpCode.isInstance(result.error)) {
            setError("Invalid code");
          } else {
            throw result.error;
          }
        }
      } finally {
        setSubmitting(false);
        setOtp("");
      }
    })());
  }, [app, otp, props.nonce, submitting]);

  return (
    <div className="stack-scope flex flex-col items-stretch">
      <form className="mb-4 flex w-full flex-col items-center">
        <Typography className="mb-4 text-center text-sm text-muted-foreground">Enter the code from your email</Typography>
        <InputOTP
          maxLength={6}
          type="text"
          inputMode="text"
          pattern="^[a-zA-Z0-9]+$"
          value={otp}
          onChange={(value) => setOtp(value.toUpperCase())}
          disabled={submitting}
        >
          <InputOTPGroup className="gap-2">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <InputOTPSlot key={index} index={index} size="lg" className="rounded-xl border border-border bg-background transition-all focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring" />
            ))}
          </InputOTPGroup>
        </InputOTP>
        <FormWarningText text={error} />
      </form>
      <Button variant="link" onClick={props.onBack} className="mt-2 text-xs text-muted-foreground hover:text-foreground">
        Cancel
      </Button>
    </div>
  );
}

export function MagicLinkSignIn() {
  const app = useStackApp();
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [nonce, setNonce] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit() {
    setEmailError(null);
    if (!isValidEmail(email)) {
      setEmailError("Please enter a valid email");
      return;
    }

    setLoading(true);
    try {
      const result = await app.sendMagicLinkEmail(email);
      if (result.status === "error") {
        setEmailError(result.error.message);
        return;
      }
      setNonce(result.data.nonce);
    } catch (error) {
      if (KnownErrors.SignUpNotEnabled.isInstance(error)) {
        setEmailError("New account registration is not allowed");
      } else {
        throw error;
      }
    } finally {
      setLoading(false);
    }
  }

  if (nonce != null) {
    return <MagicLinkOtp nonce={nonce} onBack={() => setNonce(null)} />;
  }

  return (
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
        Send email
      </Button>
    </form>
  );
}
