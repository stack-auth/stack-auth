import { Button, Input, Label } from "~/components/ui";

import { yupResolver } from "@hookform/resolvers/yup";
import { getPasswordError } from '@hexclave/shared/dist/helpers/password';
import { passwordSchema as schemaFieldsPasswordSchema, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { runAsynchronously, runAsynchronouslyWithAlert } from "@hexclave/shared/dist/utils/promises";
import { useState } from "react";
import { useForm } from "react-hook-form";
import * as yup from "yup";
import { useStackApp, useUser } from "@hexclave/react";
import {
  getFieldClassName,
  getOutlineButtonClassName,
  getPrimaryButtonClassName,
  useDesign,
} from "../design-context";
import { Section } from "../section";

export function PasswordSection(props?: {
  mockMode?: boolean,
}) {
  const isInMockMode = !!props?.mockMode;
  const user = useUser({ or: isInMockMode ? 'return-null' : "throw" });
  const project = useStackApp().useProject();

  // In mock mode, show a placeholder message
  if (isInMockMode && !user) {
    return (
      <Section
        title="Password"
        description="Password management is not available in demo mode."
      >
        <span className="text-sm text-muted-foreground">Password management is not available in demo mode.</span>
      </Section>
    );
  }

  if (!user) {
    return null;
  }

  if (!project.config.credentialEnabled) {
    return null;
  }

  return <PasswordSectionInner user={user} />;
}

function PasswordSectionInner({ user }: { user: any }) {
  const design = useDesign();
  const contactChannels = user.useContactChannels();
  const [changingPassword, setChangingPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const passwordSchema = yupObject({
    oldPassword: user.hasPassword ? schemaFieldsPasswordSchema.defined().nonEmpty('Please enter your old password') : yupString(),
    newPassword: schemaFieldsPasswordSchema.defined().nonEmpty('Please enter your password').test({
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
    newPasswordRepeat: yupString().nullable().oneOf([yup.ref('newPassword'), "", null], 'Passwords do not match').defined().nonEmpty('Please repeat your password')
  });

  const { register, handleSubmit, setError, formState: { errors }, clearErrors, reset } = useForm({
    resolver: yupResolver(passwordSchema)
  });

  const hasValidEmail = contactChannels.filter((x: any) => (x.type as string) === 'email' && x.usedForAuth).length > 0;

  const onSubmit = async (data: yup.InferType<typeof passwordSchema>) => {
    setLoading(true);
    try {
      const { oldPassword, newPassword } = data;
      const error = user.hasPassword
        ? await user.updatePassword({ oldPassword: oldPassword!, newPassword })
        : await user.setPassword({ password: newPassword! });
      if (error) {
        setError('oldPassword', { type: 'manual', message: 'Incorrect password' });
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

  return (
    <Section
      title="Password"
      description={user.hasPassword ? "Update your password" : "Set a password for your account"}
    >
      <div className='flex flex-col gap-4 w-full md:w-[350px]'>
        {!changingPassword ? (
          hasValidEmail ? (
            <Button
              variant='outline'
              onClick={() => setChangingPassword(true)}
              className={getOutlineButtonClassName(design, "px-4 py-2 w-full transition-colors duration-150")}
            >
              {user.hasPassword ? "Update password" : "Set password"}
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground/85 leading-normal">
              To set a password, please add a sign-in email.
            </span>
          )
        ) : (
          <form
            onSubmit={e => runAsynchronouslyWithAlert(handleSubmit(onSubmit)(e))}
            noValidate
            className="flex flex-col gap-3"
          >
            {user.hasPassword && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="old-password">Old password</Label>
                <Input
                  id="old-password"
                  type="password"
                  autoComplete="current-password"
                  {...register("oldPassword")}
                  className={getFieldClassName(design)}
                />
                {errors.oldPassword && <span className="text-red-500 text-xs font-medium">{errors.oldPassword.message?.toString()}</span>}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="new-password">New password</Label>
              <Input
                id="new-password"
                type="password"
                autoComplete="new-password"
                {...registerPassword}
                onChange={(e) => {
                  clearErrors('newPassword');
                  clearErrors('newPasswordRepeat');
                  runAsynchronously(registerPassword.onChange(e));
                }}
                className={getFieldClassName(design)}
              />
              {errors.newPassword && <span className="text-red-500 text-xs font-medium">{errors.newPassword.message?.toString()}</span>}
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="repeat-password">Repeat new password</Label>
              <Input
                id="repeat-password"
                type="password"
                autoComplete="new-password"
                {...registerPasswordRepeat}
                onChange={(e) => {
                  clearErrors('newPassword');
                  clearErrors('newPasswordRepeat');
                  runAsynchronously(registerPasswordRepeat.onChange(e));
                }}
                className={getFieldClassName(design)}
              />
              {errors.newPasswordRepeat && <span className="text-red-500 text-xs font-medium">{errors.newPasswordRepeat.message?.toString()}</span>}
            </div>

            <div className="mt-4 flex gap-2">
              <Button
                type="submit"
                loading={loading}
                className={getPrimaryButtonClassName(design, "flex-1")}
              >
                {user.hasPassword ? "Update Password" : "Set Password"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setChangingPassword(false);
                  reset();
                }}
                className={getOutlineButtonClassName(design, "flex-1")}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </Section>
  );
}
