'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { passwordSchema, strictEmailSchema, yupObject } from "@hexclave/shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { Button, Input, Label, PasswordInput } from "@hexclave/ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp } from "..";
import { useTranslation } from "../lib/translations";
import { FormWarningText } from "./elements/form-warning";
import { StyledLink } from "./link";

export function CredentialSignIn() {
  const { t } = useTranslation();

  const schema = yupObject({
    email: strictEmailSchema(t('Please enter a valid email')).defined().nonEmpty(t('Please enter your email')),
    password: passwordSchema.defined().nonEmpty(t('Please enter your password'))
  });

  const { register, handleSubmit, setError, formState: { errors } } = useForm({
    resolver: yupResolver(schema)
  });
  const app = useStackApp();
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: yup.InferType<typeof schema>) => {
    setLoading(true);

    try {
      const { email, password } = data;
      const result = await app.signInWithCredential({
        email,
        password,
      });
      if (result.status === 'error') {
        setError('email', { type: 'manual', message: result.error.message });
      }
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
      <Label htmlFor="email" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">{t('Email')}</Label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        className="h-10 rounded-xl border border-border bg-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring transition-all"
        {...register('email')}
      />
      <FormWarningText text={errors.email?.message?.toString()} />

      <div className="flex items-center justify-between mt-4 mb-1.5">
        <Label htmlFor="password" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('Password')}</Label>
        <StyledLink href={app.urls.forgotPassword} className="text-xs text-muted-foreground hover:text-primary transition-colors">
          {t('Forgot password?')}
        </StyledLink>
      </div>
      <PasswordInput
        id="password"
        autoComplete="current-password"
        className="h-10 rounded-xl border border-border bg-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring transition-all"
        {...register('password')}
      />
      <FormWarningText text={errors.password?.message?.toString()} />

      <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow transition-all duration-150" loading={loading}>
        {t('Sign In')}
      </Button>
    </form>
  );
}
