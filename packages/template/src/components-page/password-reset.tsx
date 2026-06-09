'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { KnownErrors } from "@hexclave/shared";
import { getPasswordError } from "@hexclave/shared/dist/helpers/password";
import { passwordSchema, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { cacheFunction } from "@hexclave/shared/dist/utils/caches";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { use } from "@hexclave/shared/dist/utils/react";
import { Button, Label, PasswordInput, Typography, cn } from "@hexclave/ui";
import type { ReactNode } from "react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { StackClientApp, useStackApp } from "..";
import { FormWarningText } from "../components/elements/form-warning";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { StyledLink } from "../components/link";
import { useTranslation } from "../lib/translations";

function PasswordResetShell({
  children,
  fullPage,
}: {
  children: ReactNode,
  fullPage?: boolean,
}) {
  const content = (
    <div
      className={cn(
        "stack-scope flex w-full max-w-[400px] flex-col items-stretch text-foreground",
        fullPage ? "p-4 sm:p-6" : "p-0"
      )}
    >
      {children}
    </div>
  );

  if (!fullPage) return content;

  return (
    <MaybeFullPage fullPage={true}>
      <div className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background p-4 sm:p-6">
        {content}
      </div>
    </MaybeFullPage>
  );
}

function PasswordResetMessage({
  title,
  children,
  primaryAction,
  primaryText,
  secondaryAction,
  secondaryText,
  fullPage,
}: {
  title: string,
  children: ReactNode,
  primaryAction: () => Promise<void> | void,
  primaryText: string,
  secondaryAction?: () => Promise<void> | void,
  secondaryText?: string,
  fullPage?: boolean,
}) {
  return (
    <PasswordResetShell fullPage={fullPage}>
      <div className="text-center">
        <Typography type='h2' className="mb-2 text-xl font-semibold tracking-tight">{title}</Typography>
        <Typography className="text-sm text-muted-foreground">{children}</Typography>
      </div>
      <div className="mt-6 flex flex-col gap-2.5">
        <Button onClick={primaryAction} className="h-10 rounded-xl font-semibold shadow-sm hover:shadow transition-all duration-150">
          {primaryText}
        </Button>
        {secondaryAction && secondaryText && (
          <Button variant="secondary" onClick={secondaryAction} className="h-10 rounded-xl font-semibold">
            {secondaryText}
          </Button>
        )}
      </div>
    </PasswordResetShell>
  );
}

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
  const hexclaveApp = useStackApp();
  const [finished, setFinished] = useState(false);
  const [resetError, setResetError] = useState(false);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: yup.InferType<typeof schema>) => {
    setLoading(true);
    try {
      const { password } = data;
      const result = await hexclaveApp.resetPassword({ password, code: props.code });
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
    return (
      <PasswordResetMessage
        title={t("Password reset")}
        primaryAction={() => hexclaveApp.redirectToSignIn({ noRedirectBack: true })}
        primaryText={t("Sign in")}
        fullPage={props.fullPage}
      >
        {t("Your password has been reset. You can now sign in with your new password.")}
      </PasswordResetMessage>
    );
  }

  if (resetError) {
    return (
      <PasswordResetMessage
        title={t("Failed to reset password")}
        primaryAction={() => hexclaveApp.redirectToForgotPassword()}
        primaryText={t("Request a new link")}
        secondaryAction={() => hexclaveApp.redirectToSignIn({ noRedirectBack: true })}
        secondaryText={t("Back to sign in")}
        fullPage={props.fullPage}
      >
        {t("This reset link could not be used. Please request a new password reset link and try again.")}
      </PasswordResetMessage>
    );
  }


  return (
    <PasswordResetShell fullPage={props.fullPage}>
      <div className="text-center mb-6">
        <Typography type='h2' className="text-xl font-semibold tracking-tight mb-1">{t("Reset password")}</Typography>
        <Typography className="text-sm text-muted-foreground">
          {t("Choose a new password for your account.")}
        </Typography>
      </div>

      <form
        className="flex flex-col items-stretch stack-scope"
        onSubmit={e => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e))}
        noValidate
      >
        <Label htmlFor="password" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t("New password")}</Label>
        <PasswordInput
          id="password"
          autoComplete="new-password"
          className="h-10 rounded-xl border border-border bg-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring transition-all"
          {...register('password')}
          onChange={() => {
            clearErrors('password');
            clearErrors('passwordRepeat');
          }}
        />
        <FormWarningText text={errors.password?.message?.toString()} />

        <Label htmlFor="repeat-password" className="mt-4 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t("Repeat new password")}</Label>
        <PasswordInput
          id="repeat-password"
          autoComplete="new-password"
          className="h-10 rounded-xl border border-border bg-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring transition-all"
          {...register('passwordRepeat')}
          onChange={() => {
            clearErrors('password');
            clearErrors('passwordRepeat');
          }}
        />
        <FormWarningText text={errors.passwordRepeat?.message?.toString()} />

        <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow transition-all duration-150" loading={loading}>
          {t("Reset password")}
        </Button>
      </form>

      <div className="mt-6 text-center text-sm border-t border-border pt-5">
        <p className="text-muted-foreground">
          {t("Remembered your password?")}{" "}
          <StyledLink href={hexclaveApp.urls.signIn} className="font-medium text-primary hover:underline transition-colors" onClick={(e) => {
            runAsynchronously(hexclaveApp.redirectToSignIn({ noRedirectBack: true }));
            e.preventDefault();
          }}>
            {t("Sign in")}
          </StyledLink>
        </p>
      </div>
    </PasswordResetShell>
  );
}


const cachedVerifyPasswordResetCode = cacheFunction(async (hexclaveApp: StackClientApp<true>, code: string) => {
  return await hexclaveApp.verifyPasswordResetCode(code);
});

export function PasswordReset({
  searchParams,
  fullPage = false,
}: {
  searchParams: Record<string, string>,
  fullPage?: boolean,
}) {
  const { t } = useTranslation();
  const hexclaveApp = useStackApp();

  const invalidJsx = (
    <PasswordResetMessage
      title={t("Invalid reset link")}
      primaryAction={() => hexclaveApp.redirectToForgotPassword()}
      primaryText={t("Request a new link")}
      secondaryAction={() => hexclaveApp.redirectToSignIn({ noRedirectBack: true })}
      secondaryText={t("Back to sign in")}
      fullPage={fullPage}
    >
      {t("This password reset link is invalid. Please request a new link from the forgot password page.")}
    </PasswordResetMessage>
  );

  const expiredJsx = (
    <PasswordResetMessage
      title={t("Reset link expired")}
      primaryAction={() => hexclaveApp.redirectToForgotPassword()}
      primaryText={t("Request a new link")}
      secondaryAction={() => hexclaveApp.redirectToSignIn({ noRedirectBack: true })}
      secondaryText={t("Back to sign in")}
      fullPage={fullPage}
    >
      {t("This password reset link has expired. Please request a new link and try again.")}
    </PasswordResetMessage>
  );

  const usedJsx = (
    <PasswordResetMessage
      title={t("Reset link already used")}
      primaryAction={() => hexclaveApp.redirectToForgotPassword()}
      primaryText={t("Request a new link")}
      secondaryAction={() => hexclaveApp.redirectToSignIn({ noRedirectBack: true })}
      secondaryText={t("Back to sign in")}
      fullPage={fullPage}
    >
      {t("This password reset link has already been used. Request a new link if you still need to reset your password.")}
    </PasswordResetMessage>
  );

  const code = searchParams.code;
  if (!code) {
    return invalidJsx;
  }

  const result = use(cachedVerifyPasswordResetCode(hexclaveApp, code));

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
