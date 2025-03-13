'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { passwordSchema, strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Label, PasswordInput } from "@stackframe/stack-ui";
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
      <Label htmlFor="email" className="mb-1">{t('Email')}</Label>
      <Input
        id="email"
        type="email"
        autoComplete="email"
        {...register('email')}
      />
      <FormWarningText text={errors.email?.message?.toString()} />

      <Label htmlFor="password" className="mt-4 mb-1">{t('Password')}</Label>
      <PasswordInput
        id="password"
        autoComplete="current-password"
        {...register('password')}
      />
      <FormWarningText text={errors.password?.message?.toString()} />

      <StyledLink href={app.urls.forgotPassword} className="mt-1 text-sm">
        {t('Forgot password?')}
      </StyledLink>

      <Button type="submit" className="mt-6" loading={loading}>
        {t('Sign In')}
      </Button>
    </form>
  );
}
