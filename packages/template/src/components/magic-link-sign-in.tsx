'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { KnownErrors } from "@stackframe/stack-shared";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, InputOTP, InputOTPGroup, InputOTPSlot, Label, Typography } from "@stackframe/stack-ui";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp } from "../lib/hooks";
import { useTurnstileAuth } from "../lib/turnstile-auth";
import { useTranslation } from "../lib/translations";
import { FormWarningText } from "./elements/form-warning";

function OTP(props: {
  onBack: () => void,
  nonce: string,
}) {
  const { t } = useTranslation();
  const [otp, setOtp] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const stackApp = useStackApp();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (otp.length === 6 && !submitting) {
      setSubmitting(true);
      // eslint-disable-next-line no-restricted-syntax
      stackApp.signInWithMagicLink(otp + props.nonce)
        .then(result => {
          if (result.status === 'error') {
            if (KnownErrors.VerificationCodeError.isInstance(result.error)) {
              setError(t("Invalid code"));
            } else if (KnownErrors.InvalidTotpCode.isInstance(result.error)) {
              setError(t("Invalid TOTP code"));
            } else {
              throw result.error;
            }
          }
        })
        .catch(e => console.error(e))
        .finally(() => {
          setSubmitting(false);
          setOtp('');
        });
    }
    if (otp.length !== 0 && otp.length !== 6) {
      setError(null);
    }
  }, [otp, submitting]);

  return (
    <div className="flex flex-col items-stretch stack-scope">
      <form className='w-full flex flex-col items-center mb-2'>
        <Typography className='mb-2' >{t('Enter the code from your email')}</Typography>
        <InputOTP
          maxLength={6}
          type="text"
          inputMode="text"
          pattern={"^[a-zA-Z0-9]+$"}
          value={otp}
          onChange={value => setOtp(value.toUpperCase())}
          disabled={submitting}
        >
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <InputOTPSlot key={index} index={index} size='lg' />
            ))}
          </InputOTPGroup>
        </InputOTP>
        {error && <FormWarningText text={error} />}
      </form>
      <Button variant='link' onClick={props.onBack} className='underline'>{t('Cancel')}</Button>
    </div>
  );
}

export function MagicLinkSignIn() {
  const { t } = useTranslation();
  const app = useStackApp();
  const turnstile = useTurnstileAuth({
    action: "send_magic_link_email",
    missingVisibleChallengeMessage: t('Please solve the captcha before sending the email'),
    challengeRequiredMessage: t('Complete the captcha to continue'),
  });
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState<string | null>(null);

  const schema = yupObject({
    email: strictEmailSchema(t('Please enter a valid email')).defined().nonEmpty(t('Please enter your email'))
  });

  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: yupResolver(schema)
  });
  const registerEmail = register('email');

  const onSubmit = async (data: yup.InferType<typeof schema>) => {
    setLoading(true);
    try {
      const { email } = data;
      const turnstileResult = await turnstile.run(async (turnstileFlowOptions) => await app.sendMagicLinkEmail(email, {
        ...turnstileFlowOptions,
      }));
      if (turnstileResult.status === "blocked") {
        return;
      }
      const result = turnstileResult.result;
      if (result.status === 'error') {
        setError('email', { type: 'manual', message: result.error.message });
        return;
      } else {
        setNonce(result.data.nonce);
      }
    } catch (e) {
      if (KnownErrors.SignUpNotEnabled.isInstance(e)) {
        setError('email', { type: 'manual', message: t('New account registration is not allowed') });
      } else {
        throw e;
      }
    } finally {
      setLoading(false);
    }
  };

  if (nonce) {
    return <OTP nonce={nonce} onBack={() => setNonce(null)} />;
  } else {
    return (
      <form
        className="flex flex-col items-stretch stack-scope"
        onSubmit={e => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e))}
        noValidate
      >
        <Label htmlFor="email" className="mb-1">{t('Email')}</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          {...registerEmail}
          onChange={(e) => {
            turnstile.clearChallengeError();
            runAsynchronously(registerEmail.onChange(e));
          }}
        />
        <FormWarningText text={errors.email?.message?.toString()} />

        <Button type="submit" className="mt-6" loading={loading} disabled={!turnstile.canSubmit}>
          {t('Send email')}
        </Button>
        <FormWarningText text={turnstile.challengeError ?? undefined} />
        {turnstile.visibleTurnstileWidget}
        {turnstile.invisibleTurnstileWidget}
      </form>
    );
  }
}
