"use client";

import { InlineSaveDiscard } from "@/components/inline-save-discard";
import { ActionDialog, BrandIcons, BrowserFrame, Label, SimpleTooltip, Switch, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import {
  DesignAlert,
  DesignBadge,
  DesignButton,
  DesignCard,
  DesignCardTint,
  DesignInput,
} from "@stackframe/dashboard-ui-components";
import { DesignMenu, type DesignMenuActionItem } from "@/components/design-components/menu";
import { DesignSelectorDropdown } from "@/components/design-components/select";
import {
  AsteriskIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  GearSixIcon,
  KeyIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  PlusCircleIcon,
  PowerIcon,
  SignInIcon,
  TrashIcon,
  UserCircleIcon,
  UserPlusIcon,
} from "@phosphor-icons/react";
import { AdminProject, AuthPage } from "@stackframe/stack";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import type { RestrictedReason } from "@stackframe/stack-shared/dist/schema-fields";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { allProviders } from "@stackframe/stack-shared/dist/utils/oauth";
import { typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { useId, useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { ProviderIcon, ProviderSettingDialog, ProviderSettingSwitch, TurnOffProviderDialog } from "./providers";

type AdminOAuthProviderConfig = AdminProject['config']['oauthProviders'][number];

type OAuthAccountMergeStrategy = 'link_method' | 'raise_error' | 'allow_duplicates';

const SHARED_TOOLTIP = "Shared keys are automatically created by Stack, but show Stack's logo on the OAuth sign-in page.\n\nYou should replace these before you go into production.";

// ─── Confirmation dialogs ─────────────────────────────────────────────────

function ConfirmSignUpEnabledDialog(props: {
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  onConfirm: () => Promise<void>,
}) {
  return (
    <ActionDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Enable sign-up"
      danger
      okButton={{
        label: "Enable Sign-up",
        onClick: props.onConfirm,
      }}
      cancelButton
    >
      <DesignAlert
        variant="warning"
        title="Anyone will be able to create an account"
        description="Enabling sign-up means new accounts can be created from your auth pages without admin approval. You can disable it again at any time."
      />
    </ActionDialog>
  );
}

function ConfirmSignUpDisabledDialog(props: {
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
  onConfirm: () => Promise<void>,
}) {
  return (
    <ActionDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Disable sign-up"
      danger
      okButton={{
        label: "Disable Sign-up",
        onClick: props.onConfirm,
      }}
      cancelButton
    >
      <DesignAlert
        variant="warning"
        title="No new accounts can be created"
        description="Existing users can still sign in. Only project admins will be able to create new accounts going forward."
      />
    </ActionDialog>
  );
}

function adminProviderToConfigProvider(provider: AdminOAuthProviderConfig): CompleteConfig['auth']['oauth']['providers'][string] {
  switch (provider.type) {
    case 'shared': {
      return {
        type: provider.id as any,
        isShared: true,
        clientId: undefined,
        clientSecret: undefined,
        facebookConfigId: undefined,
        microsoftTenantId: undefined,
        appleBundles: undefined,
        allowSignIn: true,
        allowConnectedAccounts: true,
      };
    }
    case 'standard': {
      return {
        type: provider.id as any,
        isShared: false,
        clientId: provider.clientId,
        clientSecret: provider.clientSecret,
        facebookConfigId: provider.facebookConfigId,
        microsoftTenantId: provider.microsoftTenantId,
        appleBundles: provider.appleBundleIds?.length
          ? typedFromEntries(provider.appleBundleIds.map((bundleId: string) => [generateUuid(), { bundleId }] as const))
          : undefined,
        allowSignIn: true,
        allowConnectedAccounts: true,
      };
    }
    default: {
      throw new StackAssertionError(`Unknown provider type: ${(provider as { type: unknown }).type}`);
    }
  }
}

function DisabledProvidersDialog({ open, onOpenChange }: { open?: boolean, onOpenChange?: (open: boolean) => void }) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const oauthProviders = project.config.oauthProviders;
  const updateConfig = useUpdateConfig();
  const [providerSearch, setProviderSearch] = useState("");
  const filteredProviders = allProviders
    .filter((id) => id.toLowerCase().includes(providerSearch.toLowerCase()))
    .map((id) => [id, oauthProviders.find((provider: AdminOAuthProviderConfig) => provider.id === id)] as const)
    .filter(([, provider]) => {
      return !provider;
    });

  return <ActionDialog
    title="Add New Auth Method"
    open={open}
    onOpenChange={onOpenChange}
    cancelButton
  >
    <DesignInput
      className="mb-4"
      placeholder="Search for a provider..."
      value={providerSearch}
      onChange={(e) => setProviderSearch(e.target.value)}
      leadingIcon={<MagnifyingGlassIcon size={14} />}
    />
    <div className="flex gap-2 flex-wrap justify-center">
      {filteredProviders
        .map(([id, provider]) => {
          return <ProviderSettingSwitch
            key={id}
            id={id}
            provider={provider}
            updateProvider={async (provider) => {
              await updateConfig({
                adminApp: stackAdminApp,
                configUpdate: {
                  [`auth.oauth.providers.${provider.id}`]: adminProviderToConfigProvider(provider),
                },
                pushable: false,
              });
            }}
            deleteProvider={async (id) => {
              await updateConfig({
                adminApp: stackAdminApp,
                configUpdate: {
                  [`auth.oauth.providers.${id}`]: null,
                },
                pushable: false,
              });
            }}
          />;
        })}

      { filteredProviders.length === 0 && (
        <Typography variant="secondary">No providers found.</Typography>
      ) }
    </div>

  </ActionDialog>;
}

// ─── Provider action menu (dots) ──────────────────────────────────────────

function OAuthActionCell({ config }: { config: AdminOAuthProviderConfig }) {
  const stackAdminApp = useAdminApp();
  const updateConfig = useUpdateConfig();
  const [turnOffProviderDialogOpen, setTurnOffProviderDialogOpen] = useState(false);
  const [providerSettingDialogOpen, setProviderSettingDialogOpen] = useState(false);

  const updateProvider = async (provider: AdminOAuthProviderConfig) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`auth.oauth.providers.${provider.id}`]: adminProviderToConfigProvider(provider),
      },
      pushable: false,
    });
  };

  const deleteProvider = async (id: string) => {
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: {
        [`auth.oauth.providers.${id}`]: null,
      },
      pushable: false,
    });
  };

  const items: DesignMenuActionItem[] = [
    {
      id: "configure",
      label: "Configure",
      icon: <GearSixIcon size={14} />,
      onClick: () => setProviderSettingDialogOpen(true),
    },
    {
      id: "disable",
      label: "Disable Provider",
      icon: <PowerIcon size={14} />,
      itemVariant: "destructive",
      onClick: () => setTurnOffProviderDialogOpen(true),
    },
  ];

  return (
    <>
      <TurnOffProviderDialog
        open={turnOffProviderDialogOpen}
        onClose={() => setTurnOffProviderDialogOpen(false)}
        providerId={config.id}
        onConfirm={async () => {
          await deleteProvider(config.id);
        }}
      />
      <ProviderSettingDialog
        id={config.id}
        open={providerSettingDialogOpen}
        onClose={() => setProviderSettingDialogOpen(false)}
        provider={config}
        updateProvider={updateProvider}
        deleteProvider={deleteProvider}
      />

      <DesignMenu
        variant="actions"
        trigger="icon"
        triggerLabel="Open menu"
        align="end"
        withIcons
        items={items}
      />
    </>
  );
}

// ─── Method toggle row (used everywhere) ──────────────────────────────────

type MethodIcon = React.ElementType;

function MethodToggleRow({
  icon: Icon,
  label,
  hint,
  checked,
  onCheckedChange,
  density = "default",
}: {
  icon: MethodIcon,
  label: string,
  hint?: string,
  checked: boolean,
  onCheckedChange: (checked: boolean) => void,
  density?: "compact" | "default" | "card",
}) {
  const id = useId();
  const padding = density === "compact" ? "px-3 py-2.5" : density === "card" ? "p-4" : "px-3.5 py-3";
  const innerRing = density === "card"
    ? "bg-foreground/[0.03] ring-1 ring-black/[0.06] dark:ring-white/[0.06] rounded-2xl"
    : "rounded-xl hover:bg-foreground/[0.03] transition-colors duration-150 hover:transition-none";
  const iconSize = density === "card" ? 20 : 18;

  return (
    <Label
      htmlFor={id}
      className={`flex items-center gap-3 cursor-pointer ${innerRing} ${padding}`}
    >
      <div className="p-2 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04] shrink-0">
        <Icon size={iconSize} className="text-foreground/70 dark:text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{label}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
    </Label>
  );
}

// ─── Provider row ─────────────────────────────────────────────────────────

function ProviderInlineRow({ provider }: { provider: AdminOAuthProviderConfig }) {
  return (
    <DesignCardTint gradient="default" className="px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <ProviderIcon id={provider.id} size="sm" />
          <span className="text-sm font-semibold text-foreground truncate">{BrandIcons.toTitle(provider.id)}</span>
          {provider.type === 'shared' && (
            <SimpleTooltip tooltip={SHARED_TOOLTIP}>
              <DesignBadge label="Shared keys" color="orange" size="sm" />
            </SimpleTooltip>
          )}
        </div>
        <OAuthActionCell config={provider} />
      </div>
    </DesignCardTint>
  );
}

// ─── Live preview content ────────────────────────────────────────────────

function LivePreviewBody({
  config,
  passwordEnabled,
  otpEnabled,
  passkeyEnabled,
  enabledProviders,
}: {
  config: AdminProject['config'],
  passwordEnabled: boolean,
  otpEnabled: boolean,
  passkeyEnabled: boolean,
  enabledProviders: AdminOAuthProviderConfig[],
}) {
  return (
    <div className="self-stretch py-2 min-w-[400px] items-center">
      <BrowserFrame url="your-website.com/signin">
        <div className="flex flex-col items-center justify-center min-h-[400px]">
          <div className='w-full sm:max-w-xs m-auto scale-90 pointer-events-none' inert>
            <div className="absolute inset-0 bg-transparent z-10"></div>
            <AuthPage
              type="sign-in"
              mockProject={{
                config: {
                  ...config,
                  credentialEnabled: passwordEnabled,
                  magicLinkEnabled: otpEnabled,
                  passkeyEnabled: passkeyEnabled,
                  oauthProviders: enabledProviders,
                },
              }}
            />
          </div>
        </div>
      </BrowserFrame>
    </div>
  );
}

const MERGE_STRATEGY_SHORT: Record<OAuthAccountMergeStrategy, string> = {
  link_method: "Link providers",
  allow_duplicates: "Allow duplicates",
  raise_error: "Block multiple",
};

// ─── Designed Email Verification toggle (logic copied from EmailVerificationSetting) ──

type AffectedUser = {
  id: string,
  displayName: string | null,
  primaryEmail: string | null,
  restrictedReason: RestrictedReason,
};

type PendingChange = {
  affectedUsers: AffectedUser[],
  totalAffectedCount: number,
  onConfirm: () => Promise<void>,
};

function useEmailVerificationToggle() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const projectConfig = project.useConfig();
  const updateConfig = useUpdateConfig();
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);

  const checked = projectConfig.onboarding.requireEmailVerification;

  const handleChange = async (next: boolean) => {
    if (next && !projectConfig.onboarding.requireEmailVerification) {
      const preview = await (stackAdminApp as any).previewAffectedUsersByOnboardingChange(
        { requireEmailVerification: true },
        10,
      );
      if (preview.totalAffectedCount > 0) {
        setPendingChange({
          affectedUsers: preview.affectedUsers,
          totalAffectedCount: preview.totalAffectedCount,
          onConfirm: async () => {
            await updateConfig({
              adminApp: stackAdminApp,
              configUpdate: { "onboarding.requireEmailVerification": true },
              pushable: true,
            });
            setPendingChange(null);
          },
        });
        return;
      }
    }
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate: { "onboarding.requireEmailVerification": next },
      pushable: true,
    });
  };

  const onCheckedChange = (next: boolean) => {
    runAsynchronouslyWithAlert(handleChange(next));
  };

  const dialog = (
    <ActionDialog
      open={!!pendingChange}
      onClose={() => setPendingChange(null)}
      title="Enable email verification requirement"
      danger
      okButton={{
        label: "Apply Change",
        onClick: async () => {
          await pendingChange?.onConfirm();
        },
      }}
      cancelButton={{ label: "Cancel" }}
    >
      <div className="flex flex-col gap-4">
        <DesignAlert
          variant="warning"
          title={`${pendingChange?.totalAffectedCount ?? 0} user${(pendingChange?.totalAffectedCount ?? 0) === 1 ? "" : "s"} will be required to verify their email`}
          description="Affected users will be prompted to verify their email the next time they visit your application."
        />
        {pendingChange && pendingChange.affectedUsers.length > 0 && (
          <div className="flex flex-col gap-2">
            <Typography variant="secondary" type="label">
              Affected users
            </Typography>
            <div className="rounded-xl ring-1 ring-black/[0.06] dark:ring-white/[0.06] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-foreground/[0.04]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">User</th>
                    <th className="px-3 py-2 text-left font-medium">Email</th>
                    <th className="px-3 py-2 text-left font-medium">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingChange.affectedUsers.map((user) => (
                    <tr key={user.id} className="border-t border-black/[0.06] dark:border-white/[0.06]">
                      <td className="px-3 py-2">
                        {user.displayName || <span className="text-muted-foreground italic">No name</span>}
                      </td>
                      <td className="px-3 py-2">
                        {user.primaryEmail || <span className="text-muted-foreground italic">No email</span>}
                      </td>
                      <td className="px-3 py-2">
                        <DesignBadge
                          label={user.restrictedReason.type === "email_not_verified" ? "Email not verified" : "Anonymous user"}
                          color="orange"
                          size="sm"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {pendingChange.totalAffectedCount > pendingChange.affectedUsers.length && (
              <Typography variant="secondary" type="footnote">
                ... and {pendingChange.totalAffectedCount - pendingChange.affectedUsers.length} more user{pendingChange.totalAffectedCount - pendingChange.affectedUsers.length === 1 ? "" : "s"}
              </Typography>
            )}
          </div>
        )}
      </div>
    </ActionDialog>
  );

  return { checked, onCheckedChange, dialog };
}

// ─── Page ─────────────────────────────────────────────────────────────────

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const oauthProviders = project.config.oauthProviders;
  const updateConfig = useUpdateConfig();
  const [confirmSignUpEnabled, setConfirmSignUpEnabled] = useState(false);
  const [confirmSignUpDisabled, setConfirmSignUpDisabled] = useState(false);
  const [disabledProvidersDialogOpen, setDisabledProvidersDialogOpen] = useState(false);

  // ===== AUTH METHODS local state =====
  const [localPasswordEnabled, setLocalPasswordEnabled] = useState<boolean | undefined>(undefined);
  const [localOtpEnabled, setLocalOtpEnabled] = useState<boolean | undefined>(undefined);
  const [localPasskeyEnabled, setLocalPasskeyEnabled] = useState<boolean | undefined>(undefined);

  const passwordEnabled = localPasswordEnabled ?? config.auth.password.allowSignIn;
  const otpEnabled = localOtpEnabled ?? config.auth.otp.allowSignIn;
  const passkeyEnabled = localPasskeyEnabled ?? config.auth.passkey.allowSignIn;

  const authMethodsHasChanges = useMemo(() =>
    localPasswordEnabled !== undefined ||
    localOtpEnabled !== undefined ||
    localPasskeyEnabled !== undefined,
  [localPasswordEnabled, localOtpEnabled, localPasskeyEnabled]);

  const handleAuthMethodsSave = async () => {
    const configUpdate: Record<string, boolean> = {};
    if (localPasswordEnabled !== undefined) {
      configUpdate['auth.password.allowSignIn'] = localPasswordEnabled;
    }
    if (localOtpEnabled !== undefined) {
      configUpdate['auth.otp.allowSignIn'] = localOtpEnabled;
    }
    if (localPasskeyEnabled !== undefined) {
      configUpdate['auth.passkey.allowSignIn'] = localPasskeyEnabled;
    }
    await updateConfig({ adminApp: stackAdminApp, configUpdate, pushable: true });
    setLocalPasswordEnabled(undefined);
    setLocalOtpEnabled(undefined);
    setLocalPasskeyEnabled(undefined);
  };

  const handleAuthMethodsDiscard = () => {
    setLocalPasswordEnabled(undefined);
    setLocalOtpEnabled(undefined);
    setLocalPasskeyEnabled(undefined);
  };

  // ===== SIGN-UP local state =====
  const [localAllowSignUp, setLocalAllowSignUp] = useState<boolean | undefined>(undefined);
  const [localMergeStrategy, setLocalMergeStrategy] = useState<OAuthAccountMergeStrategy | undefined>(undefined);

  const allowSignUp = localAllowSignUp ?? config.auth.allowSignUp;
  const mergeStrategy = localMergeStrategy ?? config.auth.oauth.accountMergeStrategy;

  const signUpHasChanges = useMemo(() =>
    localAllowSignUp !== undefined || localMergeStrategy !== undefined,
  [localAllowSignUp, localMergeStrategy]);

  const handleSignUpSave = async () => {
    if (localAllowSignUp !== undefined && localAllowSignUp !== config.auth.allowSignUp) {
      if (localAllowSignUp) {
        setConfirmSignUpEnabled(true);
      } else {
        setConfirmSignUpDisabled(true);
      }
      return;
    }

    if (localMergeStrategy !== undefined) {
      await updateConfig({
        adminApp: stackAdminApp,
        configUpdate: { 'auth.oauth.accountMergeStrategy': localMergeStrategy },
        pushable: true,
      });
    }
    setLocalAllowSignUp(undefined);
    setLocalMergeStrategy(undefined);
  };

  const handleSignUpDiscard = () => {
    setLocalAllowSignUp(undefined);
    setLocalMergeStrategy(undefined);
  };

  const handleSignUpConfirmed = async (newAllowSignUp: boolean) => {
    const configUpdate: Record<string, any> = { 'auth.allowSignUp': newAllowSignUp };
    if (localMergeStrategy !== undefined) {
      configUpdate['auth.oauth.accountMergeStrategy'] = localMergeStrategy;
    }
    await updateConfig({ adminApp: stackAdminApp, configUpdate, pushable: true });
    setLocalAllowSignUp(undefined);
    setLocalMergeStrategy(undefined);
  };

  // ===== USER DELETION local state =====
  const [localAllowClientDeletion, setLocalAllowClientDeletion] = useState<boolean | undefined>(undefined);
  const allowClientDeletion = localAllowClientDeletion ?? config.users.allowClientUserDeletion;
  const userDeletionHasChanges = localAllowClientDeletion !== undefined;

  const handleUserDeletionSave = async () => {
    if (localAllowClientDeletion !== undefined) {
      await updateConfig({
        adminApp: stackAdminApp,
        configUpdate: { 'users.allowClientUserDeletion': localAllowClientDeletion },
        pushable: true,
      });
    }
    setLocalAllowClientDeletion(undefined);
  };

  const handleUserDeletionDiscard = () => {
    setLocalAllowClientDeletion(undefined);
  };

  const enabledProviders = allProviders
    .map((id) => [id, oauthProviders.find((provider: AdminOAuthProviderConfig) => provider.id === id)] as const)
    .filter(([, provider]) => !!provider);

  const enabledProvidersList = enabledProviders
    .map(([, provider]) => provider)
    .filter((provider): provider is AdminOAuthProviderConfig => !!provider);

  // ===== Toggle helpers =====
  const onPasswordChange = (checked: boolean) => {
    setLocalPasswordEnabled(checked === config.auth.password.allowSignIn ? undefined : checked);
  };
  const onOtpChange = (checked: boolean) => {
    setLocalOtpEnabled(checked === config.auth.otp.allowSignIn ? undefined : checked);
  };
  const onPasskeyChange = (checked: boolean) => {
    setLocalPasskeyEnabled(checked === config.auth.passkey.allowSignIn ? undefined : checked);
  };
  const onAllowSignUpChange = (checked: boolean) => {
    setLocalAllowSignUp(checked === config.auth.allowSignUp ? undefined : checked);
  };
  const onMergeStrategyChange = (value: string) => {
    const next = value as OAuthAccountMergeStrategy;
    setLocalMergeStrategy(next === config.auth.oauth.accountMergeStrategy ? undefined : next);
  };
  const onAllowClientDeletionChange = (checked: boolean) => {
    setLocalAllowClientDeletion(checked === config.users.allowClientUserDeletion ? undefined : checked);
  };

  const emailVerification = useEmailVerificationToggle();

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout title="Auth Methods" description="Configure how users can sign in to your app">
        <section className="flex flex-col gap-4">
          <div className="flex gap-4">
            <DesignCard
              title="Sign-in methods"
              subtitle="Each method below is independently toggleable"
              icon={UserCircleIcon}
              className="flex-grow"
              gradient="default"
            >
              <div className="flex flex-col gap-2">
                <MethodToggleRow icon={AsteriskIcon} label="Email/password authentication" hint="Classic email + password credentials." checked={passwordEnabled} onCheckedChange={onPasswordChange} density="default" />
                <MethodToggleRow icon={LinkIcon} label="Magic link (Email OTP)" hint="One-time codes delivered by email." checked={otpEnabled} onCheckedChange={onOtpChange} density="default" />
                <MethodToggleRow icon={KeyIcon} label="Passkey" hint="Phishing-resistant device-bound credentials." checked={passkeyEnabled} onCheckedChange={onPasskeyChange} density="default" />
              </div>
              <InlineSaveDiscard hasChanges={authMethodsHasChanges} onSave={handleAuthMethodsSave} onDiscard={handleAuthMethodsDiscard} />

              <div className="mt-5 mb-3">
                <div className="text-xs font-semibold uppercase tracking-wider text-foreground">SSO Providers</div>
              </div>
              <div className="flex flex-col gap-2">
                {enabledProvidersList.map(provider => (
                  <ProviderInlineRow key={provider.id} provider={provider} />
                ))}
                {enabledProvidersList.length === 0 && (
                  <DesignAlert
                    variant="info"
                    description="No SSO providers enabled. Add one to let users sign in with their existing accounts."
                  />
                )}
              </div>
              <DesignButton
                className="mt-4 w-fit"
                onClick={() => setDisabledProvidersDialogOpen(true)}
                variant="secondary"
              >
                <PlusCircleIcon size={16} className="mr-1.5" />
                Add SSO providers
              </DesignButton>
            </DesignCard>
            <DesignCard
              title="Live preview"
              icon={EyeIcon}
              className="hidden lg:flex"
              gradient="default"
            >
              <LivePreviewBody
                config={project.config}
                passwordEnabled={passwordEnabled}
                otpEnabled={otpEnabled}
                passkeyEnabled={passkeyEnabled}
                enabledProviders={enabledProvidersList}
              />
            </DesignCard>
          </div>

          <DesignCard title="Sign-up" subtitle="Account creation policies for new users" icon={UserPlusIcon} gradient="default">
            <div className="flex flex-col gap-2">
              <MethodToggleRow
                icon={SignInIcon}
                label="Allow new user sign-ups"
                checked={allowSignUp}
                onCheckedChange={onAllowSignUpChange}
                density="compact"
              />
              <MethodToggleRow
                icon={EnvelopeSimpleIcon}
                label="Require email verification"
                checked={emailVerification.checked}
                onCheckedChange={emailVerification.onCheckedChange}
                density="compact"
              />
              <Label
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-foreground/[0.03] transition-colors duration-150 hover:transition-none cursor-pointer"
              >
                <div className="p-2 rounded-lg bg-foreground/[0.06] dark:bg-foreground/[0.04] shrink-0">
                  <UserCircleIcon size={18} className="text-foreground/70 dark:text-muted-foreground" aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-foreground truncate">Multi-provider sign-up mode</div>
                </div>
                <DesignSelectorDropdown
                  value={mergeStrategy}
                  onValueChange={onMergeStrategyChange}
                  options={[
                    { value: "link_method", label: MERGE_STRATEGY_SHORT.link_method },
                    { value: "allow_duplicates", label: MERGE_STRATEGY_SHORT.allow_duplicates },
                    { value: "raise_error", label: MERGE_STRATEGY_SHORT.raise_error },
                  ]}
                  size="sm"
                  className="w-[180px]"
                />
              </Label>
            </div>
            <InlineSaveDiscard hasChanges={signUpHasChanges} onSave={handleSignUpSave} onDiscard={handleSignUpDiscard} />
          </DesignCard>

          <DesignCard title="User deletion" subtitle="Self-service account removal" icon={TrashIcon} gradient="default">
            <MethodToggleRow
              icon={TrashIcon}
              label="Allow users to delete their own accounts on the client-side"
              hint="A delete button will also be added to the account settings page."
              checked={allowClientDeletion}
              onCheckedChange={onAllowClientDeletionChange}
              density="default"
            />
            <InlineSaveDiscard hasChanges={userDeletionHasChanges} onSave={handleUserDeletionSave} onDiscard={handleUserDeletionDiscard} />
          </DesignCard>

          <div className="h-5 shrink-0" aria-hidden="true" />
        </section>

        <ConfirmSignUpEnabledDialog
          open={confirmSignUpEnabled}
          onOpenChange={setConfirmSignUpEnabled}
          onConfirm={async () => {
            await handleSignUpConfirmed(true);
          }}
        />
        <ConfirmSignUpDisabledDialog
          open={confirmSignUpDisabled}
          onOpenChange={setConfirmSignUpDisabled}
          onConfirm={async () => {
            await handleSignUpConfirmed(false);
          }}
        />
        <DisabledProvidersDialog
          open={disabledProvidersDialogOpen}
          onOpenChange={(x) => setDisabledProvidersDialogOpen(x)}
        />
        {emailVerification.dialog}
      </PageLayout>
    </AppEnabledGuard>
  );
}
