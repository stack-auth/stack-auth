'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { KnownErrors } from "@stackframe/stack-shared";
import { getPasswordError } from "@stackframe/stack-shared/dist/helpers/password";
import { passwordSchema, strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Label, PasswordInput } from "@stackframe/stack-ui";
import React, { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp } from "../lib/hooks";
import { getTurnstileInvisibleSiteKey, getTurnstileSiteKey, useTurnstile } from "../lib/turnstile";
import { useTranslation } from "../lib/translations";
import { FormWarningText } from "./elements/form-warning";

export function CredentialSignUp(props: { noPasswordRepeat?: boolean }) {
  const { t } = useTranslation();

  const schema = yupObject({
    email: strictEmailSchema(t('Please enter a valid email')).defined().nonEmpty(t('Please enter your email')),
    password: passwordSchema.defined().nonEmpty(t('Please enter your password')).test({
      name: 'is-valid-password',
      test: (value, ctx) => {
        const error = getPasswordError(value);
        if (error) {
          return ctx.createError({ message: error.message });
        } else {
          return true;
        }
      }
    }),
    ...(!props.noPasswordRepeat && {
      passwordRepeat: passwordSchema.nullable().oneOf([yup.ref('password'), "", null], t('Passwords do not match')).nonEmpty(t('Please repeat your password'))
    })
  });

  const { register, handleSubmit, setError, formState: { errors }, clearErrors } = useForm({
    resolver: yupResolver(schema)
  });
  const app = useStackApp();
  const visibleTurnstileSiteKey = getTurnstileSiteKey(app);
  const invisibleTurnstileSiteKey = getTurnstileInvisibleSiteKey(app);
  const usesDedicatedInvisibleTurnstileSiteKey = invisibleTurnstileSiteKey !== visibleTurnstileSiteKey;
  const [challengeRequiredResult, setChallengeRequiredResult] = useState<"invalid" | "error" | null>(null);
  const [visibleTurnstileToken, setVisibleTurnstileToken] = useState<string | null>(null);
  const [challengeError, setChallengeError] = useState<string | null>(null);
  const { executeTurnstile: executeInvisibleTurnstile, turnstileWidget: invisibleTurnstileWidget } = useTurnstile({
    siteKey: invisibleTurnstileSiteKey,
    action: "sign_up_with_credential",
    appearance: "interaction-only",
    execution: "execute",
    size: usesDedicatedInvisibleTurnstileSiteKey ? "invisible" : undefined,
  });
  const {
    resetTurnstile: resetVisibleTurnstile,
    turnstileWidget: visibleTurnstileWidget,
  } = useTurnstile({
    siteKey: visibleTurnstileSiteKey,
    action: "sign_up_with_credential",
    appearance: "always",
    execution: "render",
    size: "flexible",
    enabled: challengeRequiredResult != null,
    onTokenChange: (token) => {
      setVisibleTurnstileToken(token);
      if (token != null) {
        setChallengeError(null);
      }
    },
    onError: (message) => {
      setChallengeError(message);
    },
  });
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: yup.InferType<typeof schema>) => {
    setLoading(true);
    try {
      const { email, password } = data;
      const visibleChallengeToken = visibleTurnstileToken;
      if (challengeRequiredResult != null && visibleChallengeToken == null) {
        setChallengeError(t('Please solve the captcha before signing up'));
        return;
      }
      let result;
      if (challengeRequiredResult == null) {
        result = await app.signUpWithCredential({
          email,
          password,
          turnstileToken: await executeInvisibleTurnstile(),
          turnstilePhase: "invisible",
        });
      } else {
        const requiredVisibleChallengeToken = visibleChallengeToken;
        if (requiredVisibleChallengeToken == null) {
          throw new Error("Visible Turnstile token was cleared before sign-up could continue.");
        }
        result = await app.signUpWithCredential({
          email,
          password,
          turnstileToken: requiredVisibleChallengeToken,
          turnstilePhase: "visible",
          previousTurnstileResult: challengeRequiredResult,
        });
      }
      if (result.status === 'error') {
        if (KnownErrors.TurnstileChallengeRequired.isInstance(result.error)) {
          const [invisibleResult] = result.error.constructorArgs;
          setChallengeRequiredResult(invisibleResult);
          setVisibleTurnstileToken(null);
          resetVisibleTurnstile();
          setChallengeError(t('Complete the captcha to finish signing up'));
        } else {
          setError('email', { type: 'manual', message: result.error.message });
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const registerEmail = register('email');
  const registerPassword = register('password');
  const registerPasswordRepeat = register('passwordRepeat');

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
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          setChallengeError(null);
          runAsynchronously(registerEmail.onChange(e));
        }}
      />
      <FormWarningText text={errors.email?.message?.toString()} />

      <Label htmlFor="password" className="mt-4 mb-1">{t('Password')}</Label>
      <PasswordInput
        id="password"
        autoComplete="new-password"
        {...registerPassword}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          clearErrors('password');
          clearErrors('passwordRepeat');
          setChallengeError(null);
          runAsynchronously(registerPassword.onChange(e));
        }}
      />
      <FormWarningText text={errors.password?.message?.toString()} />
      {
        !props.noPasswordRepeat && (
          <>
            <Label htmlFor="repeat-password" className="mt-4 mb-1">{t('Repeat Password')}</Label>
            <PasswordInput
              id="repeat-password"
              {...registerPasswordRepeat}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              clearErrors('password');
              clearErrors('passwordRepeat');
              setChallengeError(null);
              runAsynchronously(registerPasswordRepeat.onChange(e));
              }}
            />
            <FormWarningText text={errors.passwordRepeat?.message?.toString()} />
          </>
        )
      }

      <Button type="submit" className="mt-6" loading={loading} disabled={challengeRequiredResult != null && visibleTurnstileToken == null}>
        {t('Sign Up')}
      </Button>
      <FormWarningText text={challengeError ?? undefined} />
      {challengeRequiredResult != null ? visibleTurnstileWidget : null}
      {invisibleTurnstileWidget}
    </form>
  );
}
