'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { getPasswordError } from "@stackframe/stack-shared/dist/helpers/password";
import { passwordSchema, strictEmailSchema, yupObject } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Label, PasswordInput } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp } from "..";
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
      <Label htmlFor="email" className="mb-1">{t('Email')}</Label>
      <Input id="email" type="email" autoComplete="email" {...register('email')}/>
      <FormWarningText text={errors.email?.message?.toString()} />

      <Label htmlFor="password" className="mt-4 mb-1">{t('Password')}</Label>
      <PasswordInput
        id="password"
        autoComplete="new-password"
        {...registerPassword}
        onChange={(e) => {
          clearErrors('password');
          clearErrors('passwordRepeat');
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
              onChange={(e) => {
              clearErrors('password');
              clearErrors('passwordRepeat');
              runAsynchronously(registerPasswordRepeat.onChange(e));
              }}
            />
            <FormWarningText text={errors.passwordRepeat?.message?.toString()} />
          </>
        )
      }

      <Button type="submit" className="mt-6" loading={loading}>
        {t('Sign Up')}
      </Button>
    </form>
  );
}
