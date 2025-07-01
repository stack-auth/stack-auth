import { yupResolver } from "@hookform/resolvers/yup";
import { getPasswordError } from '@stackframe/stack-shared/dist/helpers/password';
import { passwordSchema as schemaFieldsPasswordSchema, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { Button, Input, Label, PasswordInput, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp } from '../../..';
import { FormWarningText } from "../../../components/elements/form-warning";
import { useUser } from "../../../lib/hooks";
import { useTranslation } from "../../../lib/translations";
import { Section } from "../section";


export function PasswordSection(props?: {
  mockMode?: boolean,
}) {
  const { t } = useTranslation();
  const user = useUser({ or: props?.mockMode ? 'return-null' : "throw" });

  // In mock mode, show a placeholder message
  if (props?.mockMode && !user) {
    return (
      <Section
        title={t("Password")}
        description={t("Password management is not available in demo mode.")}
      >
        <Typography variant='secondary'>{t("Password management is not available in demo mode.")}</Typography>
      </Section>
    );
  }

  if (!user) {
    return null; // This shouldn't happen in non-mock mode due to throw
  }
  const contactChannels = user.useContactChannels();
  const [changingPassword, setChangingPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const project = useStackApp().useProject();

  const passwordSchema = yupObject({
    oldPassword: user.hasPassword ? schemaFieldsPasswordSchema.defined().nonEmpty(t('Please enter your old password')) : yupString(),
    newPassword: schemaFieldsPasswordSchema.defined().nonEmpty(t('Please enter your password')).test({
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
    newPasswordRepeat: yupString().nullable().oneOf([yup.ref('newPassword'), "", null], t('Passwords do not match')).defined().nonEmpty(t('Please repeat your password'))
  });

  const { register, handleSubmit, setError, formState: { errors }, clearErrors, reset } = useForm({
    resolver: yupResolver(passwordSchema)
  });

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const hasValidEmail = contactChannels.filter(x => x.type === 'email' && x.usedForAuth).length > 0;

  const onSubmit = async (data: yup.InferType<typeof passwordSchema>) => {
    setLoading(true);
    try {
      const { oldPassword, newPassword } = data;
      const error = user.hasPassword
        ? await user.updatePassword({ oldPassword: oldPassword!, newPassword })
        : await user.setPassword({ password: newPassword! });
      if (error) {
        setError('oldPassword', { type: 'manual', message: t('Incorrect password') });
      } else {
        reset();
        setChangingPassword(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const registerPassword = register('newPassword');
  const registerPasswordRepeat = register('newPasswordRepeat');

  if (!project.config.credentialEnabled) {
    return null;
  }

  return (
    <Section
      title={t("Password")}
      description={user.hasPassword ? t("Update your password") : t("Set a password for your account")}
    >
      <div className='flex flex-col gap-4'>
        {!changingPassword ? (
          hasValidEmail ? (
            <Button
              variant='secondary'
              onClick={() => setChangingPassword(true)}
            >
              {user.hasPassword ? t("Update password") : t("Set password")}
            </Button>
          ) : (
            <Typography variant='secondary' type='label'>{t("To set a password, please add a sign-in email.")}</Typography>
          )
        ) : (
          <form
            onSubmit={e => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e))}
            noValidate
          >
            {user.hasPassword && (
              <>
                <Label htmlFor="old-password" className="mb-1">{t("Old password")}</Label>
                <Input
                  id="old-password"
                  type="password"
                  autoComplete="current-password"
                  {...register("oldPassword")}
                />
                <FormWarningText text={errors.oldPassword?.message?.toString()} />
              </>
            )}

            <Label htmlFor="new-password" className="mt-4 mb-1">{t("New password")}</Label>
            <PasswordInput
              id="new-password"
              autoComplete="new-password"
              {...registerPassword}
              onChange={(e) => {
                clearErrors('newPassword');
                clearErrors('newPasswordRepeat');
                runAsynchronously(registerPassword.onChange(e));
              }}
            />
            <FormWarningText text={errors.newPassword?.message?.toString()} />

            <Label htmlFor="repeat-password" className="mt-4 mb-1">{t("Repeat new password")}</Label>
            <PasswordInput
              id="repeat-password"
              autoComplete="new-password"
              {...registerPasswordRepeat}
              onChange={(e) => {
                clearErrors('newPassword');
                clearErrors('newPasswordRepeat');
                runAsynchronously(registerPasswordRepeat.onChange(e));
              }}
            />
            <FormWarningText text={errors.newPasswordRepeat?.message?.toString()} />

            <div className="mt-6 flex gap-4">
              <Button type="submit" loading={loading}>
                {user.hasPassword ? t("Update Password") : t("Set Password")}
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setChangingPassword(false);
                  reset();
                }}
              >
                {t("Cancel")}
              </Button>
            </div>
          </form>
        )}
      </div>
    </Section>
  );
}
