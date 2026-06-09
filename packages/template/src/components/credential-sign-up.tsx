'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { getPasswordError } from "@hexclave/shared/dist/helpers/password";
import { passwordSchema, strictEmailSchema, yupObject } from "@hexclave/shared/dist/schema-fields";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { Button, Input, Label, PasswordInput } from "@hexclave/ui";
import React, { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp } from "../lib/hooks";
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
  const [loading, setLoading] = useState(false);

  const onSubmit = async (data: yup.InferType<typeof schema>) => {
    setLoading(true);
    try {
      const { email, password } = data;
      const result = await app.signUpWithCredential({ email, password });
      if (result.status === 'error') {
        setError('email', { type: 'manual', message: result.error.message });
      }
    } finally {
      setLoading(false);
    }
  };

  const registerPassword = register('password');
  const registerPasswordRepeat = register('passwordRepeat');

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

      <Label htmlFor="password" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-1.5">{t('Password')}</Label>
      <PasswordInput
        id="password"
        autoComplete="new-password"
        className="h-10 rounded-xl border border-border bg-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring transition-all"
        {...registerPassword}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          clearErrors('password');
          clearErrors('passwordRepeat');
          runAsynchronously(registerPassword.onChange(e));
        }}
      />
      <FormWarningText text={errors.password?.message?.toString()} />
      {
        !props.noPasswordRepeat && (
          <>
            <Label htmlFor="repeat-password" className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mt-4 mb-1.5">{t('Repeat Password')}</Label>
            <PasswordInput
              id="repeat-password"
              className="h-10 rounded-xl border border-border bg-background focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring transition-all"
              {...registerPasswordRepeat}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              clearErrors('password');
              clearErrors('passwordRepeat');
              runAsynchronously(registerPasswordRepeat.onChange(e));
              }}
            />
            <FormWarningText text={errors.passwordRepeat?.message?.toString()} />
          </>
        )
      }

      <Button type="submit" className="mt-6 h-10 rounded-xl font-semibold shadow-sm hover:shadow transition-all duration-150" loading={loading}>
        {t('Sign Up')}
      </Button>
    </form>
  );
}
