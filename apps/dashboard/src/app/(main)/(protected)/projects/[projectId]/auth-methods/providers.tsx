"use client";
import { FormDialog } from "@/components/form-dialog";
import { InputField, SwitchField } from "@/components/form-fields";
import { getPublicEnvVar } from '@/lib/env';
import { AdminProject } from "@stackframe/stack";
import { yupBoolean, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { sharedProviders } from "@stackframe/stack-shared/dist/utils/oauth";
import { ActionDialog, Badge, BrandIcons, InlineCode, Label, SimpleTooltip, Typography } from "@stackframe/stack-ui";
import clsx from "clsx";
import { useState } from "react";
import * as yup from "yup";

export function ProviderIcon(props: { id: string }) {
  return (
    <div
      className="flex items-center justify-center w-12 h-12 rounded-md border border-gray-800"
      style={{ backgroundColor: props.id in BrandIcons.BRAND_COLORS ? BrandIcons.BRAND_COLORS[props.id] : undefined }}
    >
      <BrandIcons.Mapping iconSize={24} provider={props.id} />
    </div>
  );
}

type Props = {
  id: string,
  provider?: AdminProject['config']['oauthProviders'][number],
  updateProvider: (provider: AdminProject['config']['oauthProviders'][number]) => Promise<void>,
  deleteProvider: (id: string) => Promise<void>,
};

function toTitle(id: string) {
  return {
    github: "GitHub",
    google: "Google",
    facebook: "Facebook",
    microsoft: "Microsoft",
    spotify: "Spotify",
    discord: "Discord",
    gitlab: "GitLab",
    apple: "Apple",
    bitbucket: "Bitbucket",
    linkedin: "LinkedIn",
    x: "X",
  }[id];
}

export const providerFormSchema = yupObject({
  shared: yupBoolean().defined(),
  clientId: yupString()
    .when('shared', {
      is: false,
      then: (schema) => schema.defined().nonEmpty(),
      otherwise: (schema) => schema.optional()
    }),
  clientSecret: yupString()
    .when('shared', {
      is: false,
      then: (schema) => schema.defined().nonEmpty(),
      otherwise: (schema) => schema.optional()
    }),
  facebookConfigId: yupString().optional(),
  microsoftTenantId: yupString().optional(),
});

export type ProviderFormValues = yup.InferType<typeof providerFormSchema>

export function ProviderSettingDialog(props: Props & { open: boolean, onClose: () => void }) {
  const hasSharedKeys = sharedProviders.includes(props.id as any);
  const defaultValues = {
    shared: props.provider ? (props.provider.type === 'shared') : hasSharedKeys,
    clientId: (props.provider as any)?.clientId ?? "",
    clientSecret: (props.provider as any)?.clientSecret ?? "",
    facebookConfigId: (props.provider as any)?.facebookConfigId ?? "",
    microsoftTenantId: (props.provider as any)?.microsoftTenantId ?? "",
  };

  const onSubmit = async (values: ProviderFormValues) => {
    if (values.shared) {
      await props.updateProvider({ id: props.id, type: 'shared' });
    } else {
      await props.updateProvider({
        id: props.id,
        type: 'standard',
        clientId: values.clientId || "",
        clientSecret: values.clientSecret || "",
        facebookConfigId: values.facebookConfigId,
        microsoftTenantId: values.microsoftTenantId,
      });
    }
  };

  return (
    <FormDialog
      defaultValues={defaultValues}
      formSchema={providerFormSchema}
      onSubmit={onSubmit}
      open={props.open}
      onClose={props.onClose}
      title={`${toTitle(props.id)} OAuth provider`}
      cancelButton
      okButton={{ label: 'Save' }}
      render={(form) => (
        <>
          {hasSharedKeys ?
            <SwitchField
              control={form.control}
              name="shared"
              label="Shared keys"
            /> :
            <Typography variant="secondary" type="footnote">
              This OAuth provider does not support shared keys
            </Typography>}

          {form.watch("shared") ?
            <Typography variant="secondary" type="footnote">
              Shared keys are created by the Stack team for development. It helps you get started, but will show a Stack logo and name on the OAuth screen. This should never be enabled in production.
            </Typography> :
            <div className="flex flex-col gap-2">
              <Label>
                Redirect URL for the OAuth provider settings
              </Label>
              <Typography type="footnote">
                <InlineCode>{`${getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL')}/api/v1/auth/oauth/callback/${props.id}`}</InlineCode>
              </Typography>
            </div>}

          {!form.watch("shared") && (
            <>
              <InputField
                control={form.control}
                name="clientId"
                label="Client ID"
                placeholder="Client ID"
                required
              />

              <InputField
                control={form.control}
                name="clientSecret"
                label="Client Secret"
                placeholder="Client Secret"
                required
              />

              {props.id === 'facebook' && (
                <InputField
                  control={form.control}
                  name="facebookConfigId"
                  label="Configuration ID (only required for Facebook Business)"
                  placeholder="Facebook Config ID"
                />
              )}

              {props.id === 'microsoft' && (
                <InputField
                  control={form.control}
                  name="microsoftTenantId"
                  label="Tenant ID (required if you are using the organizational directory)"
                  placeholder="Tenant ID"
                />
              )}
            </>
          )}
        </>
      )}
    />
  );
}

export function TurnOffProviderDialog(props: {
  open: boolean,
  onClose: () => void,
  onConfirm: () => Promise<void>,
  providerId: string,
}) {
  return (
    <ActionDialog
      title={`Disable ${toTitle(props.providerId)} OAuth provider`}
      open={props.open}
      onClose={props.onClose}
      danger
      okButton={{
        label: `Disable ${toTitle(props.providerId)}`,
        onClick: async () => {
          await props.onConfirm();
        },
      }}
      cancelButton
      confirmText="I understand that this will disable sign-in and sign-up for new and existing users with this provider."
    >
      <Typography>
        Disabling this provider will prevent users from signing in with it, including existing users who have used it before. They might not be able to log in anymore. Are you sure you want to do this?
      </Typography>
    </ActionDialog>
  );
}

export function ProviderSettingSwitch(props: Props) {
  const enabled = !!props.provider;
  const isShared = props.provider?.type === 'shared';
  const [TurnOffProviderDialogOpen, setTurnOffProviderDialogOpen] = useState(false);
  const [ProviderSettingDialogOpen, setProviderSettingDialogOpen] = useState(false);

  const updateProvider = async (checked: boolean) => {
    if (checked) {
      await props.updateProvider({
        id: props.id,
        type: 'shared',
        ...props.provider,
      });
    } else {
      await props.deleteProvider(props.id);
    }
  };

  return (
    <>
      <div
        className={clsx("flex flex-col items-center justify-center gap-2 py-2 border border-1 rounded-lg p-2 w-[120px] h-[120px] cursor-pointer transition-all", enabled ? "border-white" : "border-gray-800 hover:border-gray-400")}
        onClick={() => {
          if (enabled) {
            setTurnOffProviderDialogOpen(true);
          } else {
            setProviderSettingDialogOpen(true);
          }
        }}
      >
        <ProviderIcon id={props.id} />
        <span className="text-sm">{toTitle(props.id)}</span>
        {isShared && enabled &&
          <SimpleTooltip tooltip={"Shared keys are automatically created by Stack, but show Stack's logo on the OAuth sign-in page.\n\nYou should replace these before you go into production."}>
            <Badge variant="secondary">Shared keys</Badge>
          </SimpleTooltip>
        }
      </div>

      <TurnOffProviderDialog
        open={TurnOffProviderDialogOpen}
        onClose={() => setTurnOffProviderDialogOpen(false)}
        providerId={props.id}
        onConfirm={async () => {
          await updateProvider(false);
        }}
      />

      <ProviderSettingDialog {...props} open={ProviderSettingDialogOpen} onClose={() => setProviderSettingDialogOpen(false)} />
    </>
  );
}
