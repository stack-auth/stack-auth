'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { strictEmailSchema, yupObject } from "@hexclave/shared/dist/schema-fields";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { Button, Input, Label, Typography, cn } from "@hexclave/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp, useUser } from "..";
import { FormWarningText } from "../components/elements/form-warning";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { StyledLink } from "../components/link";
import { useTranslation } from "../lib/translations";

function ForgotPasswordShell({
  children,
  fullPage,
}: {
  children: React.ReactNode,
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

function ForgotPasswordMessage({
  title,
  children,
  primaryAction,
  primaryText,
  secondaryAction,
  secondaryText,
  fullPage,
}: {
  title: string,
  children: React.ReactNode,
  primaryAction: () => Promise<void> | void,
  primaryText: string,
  secondaryAction?: () => Promise<void> | void,
  secondaryText?: string,
  fullPage?: boolean,
}) {
  return (
    <ForgotPasswordShell fullPage={fullPage}>
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
    </ForgotPasswordShell>
  );
}

export function ForgotPasswordForm({ onSent }: { onSent?: (email: string) => void }) {
  const { t } = useTranslation();

  const schema = yupObject({
    email: strictEmailSchema(t("Please enter a valid email")).defined().nonEmpty(t("Please enter your email"))
  });

  const { register, handleSubmit, formState: { errors }, clearErrors } = useForm({
    resolver: yupResolver(schema)
  });
  const hexclaveApp = useStackApp();
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: yup.InferType<typeof schema>) => {
    setLoading(true);
    try {
      const { email } = data;
      const result = await hexclaveApp.sendForgotPasswordEmail(email);
      // Show the same sent state even when the account is unknown to avoid email enumeration.
      if (result.status === "error") {
        onSent?.(email);
        return;
      }
      onSent?.(email);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form
      className="flex flex-col items-stretch stack-scope"
      onSubmit={e => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e))}
      noValidate
    >
      <Label htmlFor="email" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t("Email")}</Label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        className="h-10 rounded-xl border border-border bg-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring transition-all"
        {...register('email')}
        onChange={() => clearErrors('email')}
      />
      <FormWarningText text={errors.email?.message?.toString()} />

      <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow transition-all duration-150" loading={loading}>
        {t("Send reset email")}
      </Button>
    </form>
  );
}


export function ForgotPassword(props: { fullPage?: boolean }) {
  const { t } = useTranslation();
  const hexclaveApp = useStackApp();
  const user = useUser();
  const [sentEmail, setSentEmail] = useState<string | null>(null);

  if (user) {
    return (
      <ForgotPasswordMessage
        title={t("You're already signed in")}
        primaryAction={() => hexclaveApp.redirectToHome()}
        primaryText={t("Go home")}
        secondaryAction={() => hexclaveApp.redirectToSignOut()}
        secondaryText={t("Sign out")}
        fullPage={props.fullPage}
      >
        {t("You can continue to your account, or sign out before resetting another account's password.")}
      </ForgotPasswordMessage>
    );
  }

  if (sentEmail) {
    return (
      <ForgotPasswordMessage
        title={t("Check your email")}
        primaryAction={() => hexclaveApp.redirectToSignIn()}
        primaryText={t("Back to sign in")}
        secondaryAction={() => setSentEmail(null)}
        secondaryText={t("Use a different email")}
        fullPage={props.fullPage}
      >
        {t("If an account exists for this email, we sent password reset instructions to your inbox.")}
      </ForgotPasswordMessage>
    );
  }

  return (
    <ForgotPasswordShell fullPage={props.fullPage}>
      <div className="text-center mb-6">
        <Typography type='h2' className="text-xl font-semibold tracking-tight mb-1">{t("Reset password")}</Typography>
        <Typography className="text-sm text-muted-foreground">
          {t("Enter your email and we'll send reset instructions.")}
        </Typography>
      </div>

      <ForgotPasswordForm onSent={setSentEmail} />

      <div className="mt-6 text-center text-sm border-t border-border pt-5">
        <p className="text-muted-foreground">
          {t("Remembered your password?")}{" "}
          <StyledLink href={hexclaveApp.urls.signIn} className="font-medium text-primary hover:underline transition-colors" onClick={(e) => {
            runAsynchronously(hexclaveApp.redirectToSignIn());
            e.preventDefault();
          }}>
            {t("Sign in")}
          </StyledLink>
        </p>
      </div>
    </ForgotPasswordShell>
  );
};
