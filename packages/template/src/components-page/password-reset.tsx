'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { KnownErrors } from "@stackframe/stack-shared";
import { getPasswordError } from "@stackframe/stack-shared/dist/helpers/password";
import { passwordSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { cacheFunction } from "@stackframe/stack-shared/dist/utils/caches";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Label, PasswordInput, Typography, cn } from "@stackframe/stack-ui";
import React, { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { StackClientApp, useStackApp } from "..";
import { FormWarningText } from "../components/elements/form-warning";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { MessageCard } from "../components/message-cards/message-card";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { useTranslation } from "../lib/translations";

export default function PasswordResetForm(props: {
  code: string,
  fullPage?: boolean,
}) {
  const { t } = useTranslation();

  const schema = yupObject({
    password: passwordSchema.defined(t("Please enter your password")).nonEmpty(t("Please enter your password")).test({
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
    passwordRepeat: yupString().nullable().oneOf([yup.ref('password'), null], t("Passwords do not match")).defined().nonEmpty(t("Please repeat your password"))
  });

  const { register, handleSubmit, formState: { errors }, clearErrors } = useForm({
    resolver: yupResolver(schema)
  });
  const stackApp = useStackApp();
  const [finished, setFinished] = useState(false);
  const [resetError, setResetError] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: yup.InferType<typeof schema>) => {
    setLoading(true);
    try {
      const { password } = data;
      const result = await stackApp.resetPassword({ password, code: props.code });
      if (result.status === 'error') {
        setResetError(true);
        return;
      }

      setFinished(true);
    } finally {
      setLoading(false);
    }
  };

  if (finished) {
    return <PredefinedMessageCard type='passwordReset' fullPage={!!props.fullPage} />;
  }

  if (resetError) {
    return (
      <MessageCard title={t("Failed to reset password")} fullPage={!!props.fullPage}>
        {t("Failed to reset password. Please request a new password reset link")}
      </MessageCard>
    );
  }


  return (
    <MaybeFullPage fullPage={!!props.fullPage}>
      <div className={cn(
        "flex flex-col items-stretch max-w-[380px] flex-basis-[380px]",
        props.fullPage ? "p-4" : "p-0"
      )}>
        <div className="text-center mb-6">
          <Typography type='h2'>{t("Reset Your Password")}</Typography>
        </div>

        <form
          className="flex flex-col items-stretch"
          onSubmit={e => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e))}
          noValidate
        >
          <Label htmlFor="password" className="mb-1">{t("New Password")}</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            {...register('password')}
            onChange={() => {
              clearErrors('password');
              clearErrors('passwordRepeat');
            }}
          />
          <FormWarningText text={errors.password?.message?.toString()} />

          <Label htmlFor="repeat-password" className="mt-4 mb-1">{t("Repeat New Password")}</Label>
          <PasswordInput
            id="repeat-password"
            autoComplete="new-password"
            {...register('passwordRepeat')}
            onChange={() => {
              clearErrors('password');
              clearErrors('passwordRepeat');
            }}
          />
          <FormWarningText text={errors.passwordRepeat?.message?.toString()} />

          <Button type="submit" className="mt-6" loading={loading}>
            {t("Reset Password")}
          </Button>
        </form>
      </div>
    </MaybeFullPage>
  );
}


const cachedVerifyPasswordResetCode = cacheFunction(async (stackApp: StackClientApp<true>, code: string) => {
  return await stackApp.verifyPasswordResetCode(code);
});

export function PasswordReset({
  searchParams,
  fullPage = false,
}: {
  searchParams: Record<string, string>,
  fullPage?: boolean,
}) {
  const { t } = useTranslation();
  const stackApp = useStackApp();

  const invalidJsx = (
    <MessageCard title={t("Invalid Password Reset Link")} fullPage={fullPage}>
      <Typography>{t("Please double check if you have the correct password reset link.")}</Typography>
    </MessageCard>
  );

  const expiredJsx = (
    <MessageCard title={t("Expired Password Reset Link")} fullPage={fullPage}>
      <Typography>{t("Your password reset link has expired. Please request a new password reset link from the login page.")}</Typography>
    </MessageCard>
  );

  const usedJsx = (
    <MessageCard title={t("Used Password Reset Link")} fullPage={fullPage}>
      <Typography>{t("This password reset link has already been used. If you need to reset your password again, please request a new password reset link from the login page.")}</Typography>
    </MessageCard>
  );

  const code = searchParams.code;
  if (!code) {
    return invalidJsx;
  }

  const result = React.use(cachedVerifyPasswordResetCode(stackApp, code));

  if (result.status === 'error') {
    if (KnownErrors.VerificationCodeNotFound.isInstance(result.error)) {
      return invalidJsx;
    } else if (KnownErrors.VerificationCodeExpired.isInstance(result.error)) {
      return expiredJsx;
    } else if (KnownErrors.VerificationCodeAlreadyUsed.isInstance(result.error)) {
      return usedJsx;
    } else {
      throw result.error;
    }
  }

  return <PasswordResetForm code={code} fullPage={fullPage} />;
}
