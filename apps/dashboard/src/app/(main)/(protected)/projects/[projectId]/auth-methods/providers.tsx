"use client";
import { ChipsInputField } from "@/components/form-fields";
import { FormDialog } from "@/components/form-dialog";
import { Link } from "@/components/link";
import { ActionDialog, BrandIcons, FormControl, FormField, FormItem, FormLabel, FormMessage, InlineCode, SimpleTooltip, Typography } from "@/components/ui";
import {
  DesignAlert,
  DesignBadge,
  DesignCardTint,
  DesignInput,
  DesignPillToggle,
} from "@stackframe/dashboard-ui-components";
import { getPublicEnvVar } from '@/lib/env';
import { ArrowRightIcon, InfoIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { AdminProject } from "@stackframe/stack";
import { yupBoolean, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { sharedProviders } from "@stackframe/stack-shared/dist/utils/oauth";
import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { useWatch } from "react-hook-form";
import * as yup from "yup";

export function ProviderIcon(props: { id: string, size?: "sm" | "md" | "lg" }) {
  const size = props.size ?? "md";
  const dim = size === "sm" ? "w-9 h-9" : size === "lg" ? "w-14 h-14" : "w-12 h-12";
  const iconPx = size === "sm" ? 18 : size === "lg" ? 28 : 24;
  return (
    <div
      className={`flex items-center justify-center ${dim} rounded-xl ring-1 ring-black/[0.08] dark:ring-white/[0.08] shadow-sm`}
      style={{ backgroundColor: props.id in BrandIcons.BRAND_COLORS ? BrandIcons.BRAND_COLORS[props.id] : undefined }}
    >
      <BrandIcons.Mapping iconSize={iconPx} provider={props.id} />
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
    twitch: "Twitch",
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
  appleBundleIds: yup.array(yupString().defined()).optional(),
});

export type ProviderFormValues = yup.InferType<typeof providerFormSchema>

/** Modal chrome — "Floating soft" (variant G). */
const PROVIDER_DIALOG_CHROME_CLASS = "border-0 rounded-3xl bg-background shadow-2xl shadow-black/30 dark:shadow-black/60";

function ProviderHeader({ providerId }: { providerId: string }) {
  return (
    <div className="flex items-center gap-3">
      <ProviderIcon id={providerId} size="sm" />
      <div className="flex flex-col min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-foreground">{toTitle(providerId)}</span>
          <DesignBadge label="OAuth 2.0" color="blue" size="sm" />
        </div>
        <span className="text-[11px] text-muted-foreground">Configure credentials for this provider</span>
      </div>
    </div>
  );
}

function PillToggleControl({
  form,
  hasSharedKeys,
}: {
  form: UseFormReturn<ProviderFormValues>,
  hasSharedKeys: boolean,
}) {
  if (!hasSharedKeys) {
    return (
      <Typography variant="secondary" type="footnote">
        This OAuth provider does not support shared keys
      </Typography>
    );
  }
  return (
    <FormField
      control={form.control}
      name="shared"
      render={({ field }) => (
        <FormItem className="space-y-0">
          <FormControl>
            <DesignPillToggle
              selected={field.value ? "shared" : "custom"}
              onSelect={(id) => field.onChange(id === "shared")}
              options={[
                { id: "shared", label: "Shared keys" },
                { id: "custom", label: "Own credentials" },
              ]}
              size="sm"
              gradient="default"
              glassmorphic
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function RedirectInline({ providerId }: { providerId: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Redirect URL</span>
      <Typography type="footnote" className="break-all">
        <InlineCode>{`${getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL')}/api/v1/auth/oauth/callback/${providerId}`}</InlineCode>
      </Typography>
    </div>
  );
}

function CredentialFields({ form, providerId }: { form: UseFormReturn<ProviderFormValues>, providerId: string }) {
  const clientIdLabel = providerId === 'apple' ? "Service ID (Client ID)" : "Client ID";
  return (
    <>
      <FormField
        control={form.control}
        name="clientId"
        render={({ field }) => (
          <FormItem className="space-y-1.5">
            <FormLabel className="text-xs font-medium text-muted-foreground">{clientIdLabel}</FormLabel>
            <FormControl>
              <DesignInput {...field} value={field.value ?? ""} placeholder="Client ID" size="sm" autoComplete="off" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <FormField
        control={form.control}
        name="clientSecret"
        render={({ field }) => (
          <FormItem className="space-y-1.5">
            <FormLabel className="text-xs font-medium text-muted-foreground">Client Secret</FormLabel>
            <FormControl>
              <DesignInput {...field} value={field.value ?? ""} type="password" placeholder="Client Secret" size="sm" autoComplete="off" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      {providerId === 'facebook' && (
        <FormField
          control={form.control}
          name="facebookConfigId"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-medium text-muted-foreground">Facebook configuration ID</FormLabel>
              <FormControl>
                <DesignInput {...field} value={field.value ?? ""} placeholder="Business Config ID" size="sm" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      {providerId === 'microsoft' && (
        <FormField
          control={form.control}
          name="microsoftTenantId"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <FormLabel className="text-xs font-medium text-muted-foreground">Microsoft tenant ID</FormLabel>
              <FormControl>
                <DesignInput {...field} value={field.value ?? ""} placeholder="Organizational tenant" size="sm" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      )}
      {providerId === 'apple' && (
        <ChipsInputField
          control={form.control}
          name="appleBundleIds"
          label="Bundle IDs"
          placeholder="com.example.myiosapp"
          helperText="Optional native app bundle IDs. Press Enter or comma to add multiple."
        />
      )}
    </>
  );
}

function WarningInline() {
  return (
    <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
      <WarningCircleIcon size={14} className="mt-[2px] shrink-0" />
      <span>Stack-managed shared keys are development only — they show the Stack logo on the OAuth screen.</span>
    </p>
  );
}

function NoteInline({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-[11px] text-muted-foreground">
      <InfoIcon size={12} className="mt-[2px] shrink-0" />
      <span>{children}</span>
    </p>
  );
}

function GithubNoteInline() {
  return <NoteInline>GitHub apps must be public with read-only email permissions enabled.</NoteInline>;
}

function DocsTextLink({ providerId }: { providerId: string }) {
  return (
    <Link
      href={`https://docs.stack-auth.com/docs/concepts/auth-providers/${providerId === "x" ? "x-twitter" : providerId}`}
      target="_blank"
      className="inline-flex items-center gap-1 text-xs font-medium text-foreground/70 hover:text-foreground transition-colors"
    >
      Provider documentation
      <ArrowRightIcon size={12} />
    </Link>
  );
}

/** Flat & airy inner layout (final). */
function OAuthProviderSettingsForm(props: {
  form: UseFormReturn<ProviderFormValues>,
  providerId: string,
  hasSharedKeys: boolean,
}) {
  const shared = useWatch({ control: props.form.control, name: "shared" });

  return (
    <div className="flex flex-col gap-5 w-full">
      <ProviderHeader providerId={props.providerId} />
      <div className="flex flex-col gap-2">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Credential source</span>
        <PillToggleControl form={props.form} hasSharedKeys={props.hasSharedKeys} />
      </div>
      {shared && <WarningInline />}
      {!shared && (
        <>
          <RedirectInline providerId={props.providerId} />
          <div className="flex flex-col gap-3">
            <CredentialFields form={props.form} providerId={props.providerId} />
          </div>
          {props.providerId === 'github' && <GithubNoteInline />}
        </>
      )}
      <NoteInline>Existing user accounts transfer automatically when you change OAuth keys.</NoteInline>
      <div className="pt-1">
        <DocsTextLink providerId={props.providerId} />
      </div>
    </div>
  );
}

export function ProviderSettingDialog(props: Props & { open: boolean, onClose: () => void }) {
  const hasSharedKeys = sharedProviders.includes(props.id as any);
  const bundleIdsArray = (props.provider as any)?.appleBundleIds ?? [];

  const defaultValues = {
    shared: props.provider ? (props.provider.type === 'shared') : hasSharedKeys,
    clientId: (props.provider as any)?.clientId ?? "",
    clientSecret: (props.provider as any)?.clientSecret ?? "",
    facebookConfigId: (props.provider as any)?.facebookConfigId ?? "",
    microsoftTenantId: (props.provider as any)?.microsoftTenantId ?? "",
    appleBundleIds: Array.isArray(bundleIdsArray) ? bundleIdsArray : [],
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
        appleBundleIds: values.appleBundleIds ?? [],
      });
    }
  };

  return (
    <FormDialog<ProviderFormValues>
      defaultValues={defaultValues}
      formSchema={providerFormSchema}
      onSubmit={onSubmit}
      open={props.open}
      onClose={props.onClose}
      title={`${toTitle(props.id)} OAuth provider`}
      cancelButton
      okButton={{ label: 'Save' }}
      contentClassName={PROVIDER_DIALOG_CHROME_CLASS}
      render={(form) => (
        <OAuthProviderSettingsForm
          form={form}
          providerId={props.id}
          hasSharedKeys={hasSharedKeys}
        />
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
      <div className="flex items-center gap-3 mb-1">
        <ProviderIcon id={props.providerId} size="sm" />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-semibold text-foreground">{toTitle(props.providerId)}</span>
          <span className="text-xs text-muted-foreground">Will be removed from the sign-in surface</span>
        </div>
      </div>
      <DesignAlert
        variant="error"
        title="This action affects existing users"
        description="Disabling this provider will prevent users from signing in with it, including existing users who have already used it. They might not be able to log in anymore."
      />
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
      <DesignCardTint
        gradient="default"
        className="cursor-pointer w-[120px] h-[120px]"
      >
        <button
          type="button"
          onClick={() => {
            if (enabled) {
              setTurnOffProviderDialogOpen(true);
            } else {
              setProviderSettingDialogOpen(true);
            }
          }}
          className="flex flex-col items-center justify-center gap-2 py-2 px-2 w-full h-full text-foreground transition-all duration-150 hover:transition-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/[0.1] rounded-2xl"
        >
          <ProviderIcon id={props.id} />
          <span className="text-sm font-medium">{toTitle(props.id)}</span>
          {isShared && enabled &&
            <SimpleTooltip tooltip={"Shared keys are automatically created by Stack, but show Stack's logo on the OAuth sign-in page.\n\nYou should replace these before you go into production."}>
              <DesignBadge label="Shared keys" color="orange" size="sm" />
            </SimpleTooltip>
          }
        </button>
      </DesignCardTint>

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
