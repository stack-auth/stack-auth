'use client';

import { yupResolver } from "@hookform/resolvers/yup";
import { yupObject, yupString } from '@hexclave/shared/dist/schema-fields';
import { throwErr } from '@hexclave/shared/dist/utils/errors';
import { runAsynchronouslyWithAlert } from '@hexclave/shared/dist/utils/promises';
import { ActionDialog, Alert, AlertDescription, CopyField, Input, Label } from '@hexclave/ui';
import { useState } from "react";
import { useForm } from 'react-hook-form';
import * as yup from "yup";
import { useUser } from "@hexclave/next";
import { ApiKey, ApiKeyCreationOptions, ApiKeyType } from "./types";

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
const expiresInOptionValues = Object.keys(expiresInOptions);

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
  const user = useUser({ or: props.mockMode ? 'return-null' : 'redirect' });
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const apiKeySchema = yupObject({
    description: yupString().defined().nonEmpty('Description is required'),
    expiresIn: yupString().oneOf(expiresInOptionValues, 'Select a valid expiration').defined(),
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
    setSubmitError(null);
    try {
      const expirationMs = Number.parseInt(data.expiresIn, 10);
      if (Number.isNaN(expirationMs)) {
        throwErr("API key expiration must be one of the predefined expiration options");
      }
      const expiresAt = expirationMs === neverInMs ? undefined : new Date(Date.now() + expirationMs);
      const key = await props.createApiKey({
        description: data.description,
        expiresAt,
      });
      props.onOpenChange(false);
      reset();
      props.onKeyCreated?.(key);
    } catch (error) {
      setSubmitError("Could not create the API key. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ActionDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Create API Key"
      cancelButton
      okButton={{
        label: "Create",
        props: { loading, disabled: !user },
        onClick: async () => {
          runAsynchronouslyWithAlert(handleSubmit(onSubmit));
          return "prevent-close";
        }
      }}
    >
      <form noValidate className='flex flex-col gap-4' onSubmit={(e) => {
        e.preventDefault();
        runAsynchronouslyWithAlert(handleSubmit(onSubmit));
      }}>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor="description">Description</Label>
          <Input id="description" placeholder="My key description" {...register("description")} />
          {errors.description && <span className="text-red-500 text-xs font-medium mt-1">{errors.description.message}</span>}
        </div>
        {submitError && (
          <Alert variant="destructive">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        <div className='flex flex-col gap-1.5'>
          <Label htmlFor="expiresIn">Expiration</Label>
          <select
            id="expiresIn"
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            {...register("expiresIn")}
          >
            {Object.entries(expiresInOptions).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {errors.expiresIn && <span className="text-red-500 text-xs font-medium mt-1">{errors.expiresIn.message}</span>}
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
  onClose: () => void,
}) {
  return (
    <ActionDialog
      open={!!props.apiKey}
      onOpenChange={() => props.onClose()}
      title="API Key Created"
      okButton={{
        label: "Close",
        onClick: async () => { props.onClose(); }
      }}
    >
      <div className='flex flex-col gap-4'>
        <span className="text-sm font-medium text-foreground">
          Please copy your API key now. You will not be able to see it again.
        </span>
        <div className='flex flex-col gap-1.5'>
          <Label htmlFor="apiKey">API Key</Label>
          <CopyField type="input" value={props.apiKey?.value.secret || ''} />
        </div>
      </div>
    </ActionDialog>
  );
}
