'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { yupObject, yupString } from '@stackframe/stack-shared/dist/schema-fields';
import { captureError } from '@stackframe/stack-shared/dist/utils/errors';
import { runAsynchronously } from '@stackframe/stack-shared/dist/utils/promises';
import { ActionDialog, Button, CopyField, Input, Label, Typography } from '@stackframe/stack-ui';
import { useState } from "react";
import { useForm } from 'react-hook-form';
import * as yup from "yup";
import { useUser } from '..';
import { FormWarningText } from '../components/elements/form-warning';
import { ApiKey, ApiKeyCreationOptions, ApiKeyType } from "../lib/stack-app/api-keys";
import { useTranslation } from "../lib/translations";

// Constants for expiration options
export const neverInMs = 1000 * 60 * 60 * 24 * 365 * 200;
export const expiresInOptions = {
  [1000 * 60 * 60 * 24 * 1]: "1 day",
  [1000 * 60 * 60 * 24 * 7]: "7 days",
  [1000 * 60 * 60 * 24 * 30]: "30 days",
  [1000 * 60 * 60 * 24 * 90]: "90 days",
  [1000 * 60 * 60 * 24 * 365]: "1 year",
  [neverInMs]: "Never",
} as const;

/**
 * Dialog for creating a new API key
 */
export function CreateApiKeyDialog<Type extends ApiKeyType = ApiKeyType>(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onKeyCreated?: (key: ApiKey<Type, true>) => void,
  createApiKey: (data: ApiKeyCreationOptions<Type>) => Promise<ApiKey<Type, true>>,
  mockMode?: boolean,
}) {
  const { t } = useTranslation();
  const user = useUser({ or: props.mockMode ? 'return-null' : 'redirect' });
  const [loading, setLoading] = useState(false);

  const apiKeySchema = yupObject({
    description: yupString().defined().nonEmpty(t('Description is required')),
    expiresIn: yupString().defined(),
  });

  const { register, handleSubmit, formState: { errors }, reset } = useForm({
    resolver: yupResolver(apiKeySchema),
    defaultValues: {
      description: '',
      expiresIn: Object.keys(expiresInOptions)[2], // Default to 30 days
    }
  });

  const onSubmit = async (data: yup.InferType<typeof apiKeySchema>) => {
    setLoading(true);
    try {
      const expiresAt = new Date(Date.now() + parseInt(data.expiresIn));
      const apiKey = await props.createApiKey({
        description: data.description,
        expiresAt,
      });

      if (props.onKeyCreated) {
        props.onKeyCreated(apiKey);
      }

      reset();
      props.onOpenChange(false);
    } catch (error) {
      captureError("Failed to create API key", { error });
    } finally {
      setLoading(false);
    }
  };

  return (
    <ActionDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t('Create API Key')}
      description={t('API keys grant programmatic access to your account.')}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          runAsynchronously(handleSubmit(onSubmit));
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <Label htmlFor="description">{t('Description')}</Label>
          <Input
            id="description"
            placeholder={t('e.g. Development, Production, CI/CD')}
            {...register('description')}
          />
          {errors.description && <FormWarningText text={errors.description.message} />}
        </div>

        <div className="space-y-2">
          <Label htmlFor="expiresIn">{t('Expires In')}</Label>
          <select
            id="expiresIn"
            className="w-full p-2 border border-input rounded-md bg-background"
            {...register('expiresIn')}
          >
            {Object.entries(expiresInOptions).map(([value, label]) => (
              <option key={value} value={value}>{t(label)}</option>
            ))}
          </select>
          {errors.expiresIn && <FormWarningText text={errors.expiresIn.message} />}
        </div>

        <div className="flex justify-end gap-2 pt-4">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              reset();
              props.onOpenChange(false);
            }}
          >
            {t('Cancel')}
          </Button>
          <Button type="submit" loading={loading}>
            {t('Create')}
          </Button>
        </div>
      </form>
    </ActionDialog>
  );
}

/**
 * Dialog for showing the newly created API key
 */
export function ShowApiKeyDialog<Type extends ApiKeyType = ApiKeyType>(props: {
  apiKey: ApiKey<Type, true> | null,
  onClose?: () => void,
}) {
  const { t } = useTranslation();

  return (
    <ActionDialog
      open={!!props.apiKey}
      title={t("API Key")}
      okButton={{ label: t("Close") }}
      onClose={props.onClose}
      preventClose
      confirmText={t("I understand that I will not be able to view this key again.")}
    >
      <div className="flex flex-col gap-4">
        <Typography>
          {t("Here is your API key.")}{" "}
          <span className="font-bold">
            {t("Copy it to a safe place. You will not be able to view it again.")}
          </span>
        </Typography>
        <CopyField
          type="input"
          monospace
          value={props.apiKey?.value ?? ''}
          label={t("Secret API Key")}
        />
      </div>
    </ActionDialog>
  );
}
