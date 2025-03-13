'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Label, Typography, cn } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp, useUser } from "..";
import { FormWarningText } from "../components/elements/form-warning";
import { MaybeFullPage } from "../components/elements/maybe-full-page";
import { StyledLink } from "../components/link";
import { PredefinedMessageCard } from "../components/message-cards/predefined-message-card";
import { useTranslation } from "../lib/translations";

export function ForgotPasswordForm({ onSent }: { onSent?: () => void }) {
  const { t } = useTranslation();

  const schema = yupObject({
    email: strictEmailSchema(t("Please enter a valid email")).defined().nonEmpty(t("Please enter your email"))
  });

  const { register, handleSubmit, formState: { errors }, clearErrors } = useForm({
    resolver: yupResolver(schema)
  });
  const stackApp = useStackApp();
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: yup.InferType<typeof schema>) => {
    setLoading(true);
    try {
      const { email } = data;
      await stackApp.sendForgotPasswordEmail(email);
    onSent?.();
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
      <Label htmlFor="email" className="mb-1">{t("Your Email")}</Label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        {...register('email')}
        onChange={() => clearErrors('email')}
      />
      <FormWarningText text={errors.email?.message?.toString()} />

      <Button type="submit" className="mt-6" loading={loading}>
        {t("Send Email")}
      </Button>
    </form>
  );
}


export function ForgotPassword(props: { fullPage?: boolean }) {
  const { t } = useTranslation();
  const stackApp = useStackApp();
  const user = useUser();
  const [sent, setSent] = useState(false);

  if (user) {
    return <PredefinedMessageCard type='signedIn' fullPage={!!props.fullPage} />;
  }

  if (sent) {
    return <PredefinedMessageCard type='emailSent' fullPage={!!props.fullPage} />;
  }

  return (
    <MaybeFullPage fullPage={!!props.fullPage}>
      <div className={cn(
        "stack-scope max-w-[380px] flex-basis-[380px]",
        props.fullPage ? "p-4" : "p-0"
      )}>
        <div className="text-center">
          <Typography type='h2'>{t("Reset Your Password")}</Typography>
          <Typography>
            {t("Don't need to reset?")}{" "}
            <StyledLink href={stackApp.urls['signIn']}>
              {t("Sign in")}
            </StyledLink>
          </Typography>
        </div>
        <div className="mt-6">
          <ForgotPasswordForm onSent={() => setSent(true)} />
        </div>
      </div>
    </MaybeFullPage>
  );
};
