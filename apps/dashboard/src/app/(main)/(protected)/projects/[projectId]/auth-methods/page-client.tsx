"use client";

import { EmailVerificationSetting } from "@/components/email-verification-setting";
import { InlineSaveDiscard } from "@/components/inline-save-discard";
import { SettingCard, SettingSelect, SettingSwitch } from "@/components/settings";
import { ActionDialog, Badge, BrandIcons, BrowserFrame, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, SelectItem, SimpleTooltip, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { AsteriskIcon, DotsThreeIcon, KeyIcon, LinkIcon, PlusCircleIcon } from "@phosphor-icons/react";
import { AdminProject, AuthPage } from "@stackframe/stack";
import type { CompleteConfig } from "@stackframe/stack-shared/dist/config/schema";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { allProviders } from "@stackframe/stack-shared/dist/utils/oauth";
import { typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { generateUuid } from "@stackframe/stack-shared/dist/utils/uuids";
import { useMemo, useState } from "react";
import { CardSubtitle } from "../../../../../../../../../packages/stack-ui/dist/components/ui/card";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { ProviderIcon, ProviderSettingDialog, ProviderSettingSwitch, TurnOffProviderDialog } from "./providers";

type AdminOAuthProviderConfig = AdminProject['config']['oauthProviders'][number];

type OAuthAccountMergeStrategy = 'link_method' | 'raise_error' | 'allow_duplicates';

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
      <Typography>
        Do you really want to enable sign-up for your project? Anyone will be able to create an account on your project.
      </Typography>
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
      <Typography>
        Do you really want to disable sign-up for your project? No one except for the project admins will be able to create new accounts. However, existing users will still be able to sign in.
      </Typography>
    </ActionDialog>
  );
}

function adminProviderToConfigProvider(provider: AdminOAuthProviderConfig): CompleteConfig['auth']['oauth']['providers'][string] {
  // TODO: Remove this function (and the AdminOAuthProviderConfig type) and use the new config everywhere instead. Then we can also make allowSignIn and allowConnectedAccounts configurable
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
    <Input
      className="mb-4"
      placeholder="Search for a provider..."
      value={providerSearch}
      onChange={(e) => setProviderSearch(e.target.value)}
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
                // OAuth client ID/secret are environment-level (not pushable)
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

      { filteredProviders.length === 0 && <Typography variant="secondary">No providers found.</Typography> }
    </div>

  </ActionDialog>;
}

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
      // OAuth client ID/secret are environment-level (not pushable)
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

  return (
    <DropdownMenu>
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

      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 p-0">
          <span className="sr-only">Open menu</span>
          <DotsThreeIcon className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => { setProviderSettingDialogOpen(true); }}>
          Configure
        </DropdownMenuItem>
        <DropdownMenuItem
          className="text-red-400"
          onClick={() => { setTurnOffProviderDialogOpen(true); }}
        >
          Disable Provider
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const SHARED_TOOLTIP = "Shared keys are automatically created by Stack, but show Stack's logo on the OAuth sign-in page.\n\nYou should replace these before you go into production.";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const oauthProviders = project.config.oauthProviders;
  const updateConfig = useUpdateConfig();
  const [confirmSignUpEnabled, setConfirmSignUpEnabled] = useState(false);
  const [confirmSignUpDisabled, setConfirmSignUpDisabled] = useState(false);
  const [disabledProvidersDialogOpen, setDisabledProvidersDialogOpen] = useState(false);

  // ===== LOCAL STATE FOR AUTH METHODS =====
  const [localPasswordEnabled, setLocalPasswordEnabled] = useState<boolean | undefined>(undefined);
  const [localOtpEnabled, setLocalOtpEnabled] = useState<boolean | undefined>(undefined);
  const [localPasskeyEnabled, setLocalPasskeyEnabled] = useState<boolean | undefined>(undefined);

  // Computed values (local or config)
  const passwordEnabled = localPasswordEnabled ?? config.auth.password.allowSignIn;
  const otpEnabled = localOtpEnabled ?? config.auth.otp.allowSignIn;
  const passkeyEnabled = localPasskeyEnabled ?? config.auth.passkey.allowSignIn;

  // Check if auth methods have unsaved changes
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
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate,
      pushable: true,
    });
    // Clear local state
    setLocalPasswordEnabled(undefined);
    setLocalOtpEnabled(undefined);
    setLocalPasskeyEnabled(undefined);
  };

  const handleAuthMethodsDiscard = () => {
    setLocalPasswordEnabled(undefined);
    setLocalOtpEnabled(undefined);
    setLocalPasskeyEnabled(undefined);
  };

  // ===== LOCAL STATE FOR SIGN-UP SETTINGS =====
  const [localAllowSignUp, setLocalAllowSignUp] = useState<boolean | undefined>(undefined);
  const [localMergeStrategy, setLocalMergeStrategy] = useState<OAuthAccountMergeStrategy | undefined>(undefined);

  const allowSignUp = localAllowSignUp ?? config.auth.allowSignUp;
  const mergeStrategy = localMergeStrategy ?? config.auth.oauth.accountMergeStrategy;

  const signUpHasChanges = useMemo(() =>
    localAllowSignUp !== undefined || localMergeStrategy !== undefined,
  [localAllowSignUp, localMergeStrategy]);

  const handleSignUpSave = async () => {
    // If allowSignUp is being changed, show confirmation dialog
    if (localAllowSignUp !== undefined && localAllowSignUp !== config.auth.allowSignUp) {
      if (localAllowSignUp) {
        setConfirmSignUpEnabled(true);
      } else {
        setConfirmSignUpDisabled(true);
      }
      return; // Dialog will handle the actual save
    }

    // Otherwise just save merge strategy
    if (localMergeStrategy !== undefined) {
      await updateConfig({
        adminApp: stackAdminApp,
        configUpdate: {
          'auth.oauth.accountMergeStrategy': localMergeStrategy,
        },
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

  // Called after confirmation dialog confirms the change
  const handleSignUpConfirmed = async (newAllowSignUp: boolean) => {
    const configUpdate: Record<string, any> = {
      'auth.allowSignUp': newAllowSignUp,
    };
    if (localMergeStrategy !== undefined) {
      configUpdate['auth.oauth.accountMergeStrategy'] = localMergeStrategy;
    }
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate,
      pushable: true,
    });
    setLocalAllowSignUp(undefined);
    setLocalMergeStrategy(undefined);
  };

  // ===== LOCAL STATE FOR USER DELETION =====
  const [localAllowClientDeletion, setLocalAllowClientDeletion] = useState<boolean | undefined>(undefined);
  const allowClientDeletion = localAllowClientDeletion ?? config.users.allowClientUserDeletion;
  const userDeletionHasChanges = localAllowClientDeletion !== undefined;

  const handleUserDeletionSave = async () => {
    if (localAllowClientDeletion !== undefined) {
      await updateConfig({
        adminApp: stackAdminApp,
        configUpdate: {
          'users.allowClientUserDeletion': localAllowClientDeletion,
        },
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

  return (
    <AppEnabledGuard appId="authentication">
      <PageLayout title="Auth Methods" description="Configure how users can sign in to your app">
        <div className="flex gap-4">
          <SettingCard className="flex-grow">
            <SettingSwitch
              label={
                <div className="flex items-center gap-2">
                  <AsteriskIcon size={20} aria-hidden="true" />
                  <span>Email/password authentication</span>
                </div>
              }
              checked={passwordEnabled}
              onCheckedChange={(checked) => {
                if (checked === config.auth.password.allowSignIn) {
                  setLocalPasswordEnabled(undefined);
                } else {
                  setLocalPasswordEnabled(checked);
                }
              }}
            />
            <SettingSwitch
              label={
                <div className="flex items-center gap-2">
                  <LinkIcon size={20} />
                  <span>Magic link (Email OTP)</span>
                </div>
              }
              checked={otpEnabled}
              onCheckedChange={(checked) => {
                if (checked === config.auth.otp.allowSignIn) {
                  setLocalOtpEnabled(undefined);
                } else {
                  setLocalOtpEnabled(checked);
                }
              }}
            />
            <SettingSwitch
              label={
                <div className="flex items-center gap-2">
                  <KeyIcon size={20} />
                  <span>Passkey</span>
                </div>
              }
              checked={passkeyEnabled}
              onCheckedChange={(checked) => {
                if (checked === config.auth.passkey.allowSignIn) {
                  setLocalPasskeyEnabled(undefined);
                } else {
                  setLocalPasskeyEnabled(checked);
                }
              }}
            />
            <InlineSaveDiscard
              hasChanges={authMethodsHasChanges}
              onSave={handleAuthMethodsSave}
              onDiscard={handleAuthMethodsDiscard}
            />
            <CardSubtitle className="mt-2">
              SSO Providers
            </CardSubtitle>

            {enabledProviders.map(([, provider]) => provider)
              .filter((provider): provider is AdminOAuthProviderConfig => !!provider).map(provider => {
                return <div key={provider.id} className="flex h-10 items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ProviderIcon id={provider.id} />
                    <span className="text-sm font-semibold">{BrandIcons.toTitle(provider.id)}</span>
                    {provider.type === 'shared' && <SimpleTooltip tooltip={SHARED_TOOLTIP}>
                      <Badge variant="secondary">Shared keys</Badge>
                    </SimpleTooltip>}
                  </div>

                  <OAuthActionCell config={provider} />
                </div>;
              }) }

            <Button
              className="mt-4"
              onClick={() => {
              setDisabledProvidersDialogOpen(true);
              }}
              variant="secondary"
            >
              <PlusCircleIcon size={16}/>
              <span className="ml-2">Add SSO providers</span>
            </Button>
            <DisabledProvidersDialog
              open={disabledProvidersDialogOpen}
              onOpenChange={(x) => {
              setDisabledProvidersDialogOpen(x);
              }}
            />
          </SettingCard>
          <SettingCard className="hidden lg:flex">
            <div className="self-stretch py-4 px-4 min-w-[400px] items-center">
              <div className="w-full">
                <BrowserFrame url="your-website.com/signin">
                  <div className="flex flex-col items-center justify-center min-h-[400px]">
                    <div className='w-full sm:max-w-xs m-auto scale-90 pointer-events-none' inert>
                      {/* a transparent cover that prevents the card from being clicked, even when pointer-events is overridden */}
                      <div className="absolute inset-0 bg-transparent z-10"></div>
                      <AuthPage
                        type="sign-in"
                        mockProject={{
                          config: {
                            ...project.config,
                            oauthProviders: enabledProviders
                              .map(([, provider]) => provider)
                              .filter((provider): provider is AdminOAuthProviderConfig => !!provider),
                          },
                        }}
                      />
                    </div>
                  </div>
                </BrowserFrame>
              </div>
            </div>
          </SettingCard>
        </div>
        <SettingCard title="Sign-up">
          <SettingSwitch
            label="Allow new user sign-ups"
            checked={allowSignUp}
            onCheckedChange={(checked) => {
              if (checked === config.auth.allowSignUp) {
                setLocalAllowSignUp(undefined);
              } else {
                setLocalAllowSignUp(checked);
              }
            }}
            hint="Existing users can still sign in when sign-up is disabled. You can always create new accounts manually via the dashboard."
          />
          <EmailVerificationSetting
            showIcon
            hint="Users must verify their primary email before they can use your application. Unverified users will be restricted. Requires SDK version >=2.8.57."
          />
          <SettingSelect
            label="Sign-up mode when logging in with same email on multiple providers"
            value={mergeStrategy}
            onValueChange={(value) => {
              const newValue = value as OAuthAccountMergeStrategy;
              if (newValue === config.auth.oauth.accountMergeStrategy) {
                setLocalMergeStrategy(undefined);
              } else {
                setLocalMergeStrategy(newValue);
              }
            }}
            hint="Determines what happens when a user tries to sign in with a different OAuth provider using the same email address"
          >
            <SelectItem value="link_method">Link - Connect multiple providers to the same account</SelectItem>
            <SelectItem value="allow_duplicates">Allow - Create separate accounts for each provider</SelectItem>
            <SelectItem value="raise_error">Block - Show an error and prevent sign-in with multiple providers</SelectItem>
          </SettingSelect>
          <InlineSaveDiscard
            hasChanges={signUpHasChanges}
            onSave={handleSignUpSave}
            onDiscard={handleSignUpDiscard}
          />
        </SettingCard>

        <SettingCard title="User deletion">
          <SettingSwitch
            label="Allow users to delete their own accounts on the client-side"
            checked={allowClientDeletion}
            onCheckedChange={(checked) => {
              if (checked === config.users.allowClientUserDeletion) {
                setLocalAllowClientDeletion(undefined);
              } else {
                setLocalAllowClientDeletion(checked);
              }
            }}
          />
          <Typography variant="secondary" type="footnote">
            A delete button will also be added to the account settings page.
          </Typography>
          <InlineSaveDiscard
            hasChanges={userDeletionHasChanges}
            onSave={handleUserDeletionSave}
            onDiscard={handleUserDeletionDiscard}
          />
        </SettingCard>

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
      </PageLayout>
    </AppEnabledGuard>
  );
}
