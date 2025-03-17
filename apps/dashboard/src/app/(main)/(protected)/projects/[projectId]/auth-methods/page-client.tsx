"use client";

import { SettingCard, SettingSelect, SettingSwitch } from "@/components/settings";
import { AdminOAuthProviderConfig, AuthPage, OAuthProviderConfig } from "@stackframe/stack";
import { allProviders } from "@stackframe/stack-shared/dist/utils/oauth";
import { ActionDialog, Badge, BrandIcons, BrowserFrame, Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, SelectItem, SimpleTooltip, Typography } from "@stackframe/stack-ui";
import { AsteriskSquare, CirclePlus, Key, Link2, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { CardSubtitle } from "../../../../../../../../../packages/stack-ui/dist/components/ui/card";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { ProviderSettingDialog, ProviderSettingSwitch, TurnOffProviderDialog } from "./providers";

type OAuthAccountMergeStrategy = 'link_method' | 'raise_error' | 'allow_duplicates';

function ConfirmSignUpEnabledDialog(props: {
  open?: boolean,
  onOpenChange?: (open: boolean) => void,
}) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();

  return (
    <ActionDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Enable sign-up"
      danger
      okButton={{
        label: "Enable Sign-up",
        onClick: async () => {
          await project.update({
            config: {
              signUpEnabled: true,
            },
          });
        }
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
}) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();

  return (
    <ActionDialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      title="Disable sign-up"
      danger
      okButton={{
        label: "Disable Sign-up",
        onClick: async () => {
          await project.update({
            config: {
              signUpEnabled: false,
            },
          });
        }
      }}
      cancelButton
    >
      <Typography>
        Do you really want to disable sign-up for your project? No one except for the project admins will be able to create new accounts. However, existing users will still be able to sign in.
      </Typography>
    </ActionDialog>
  );
}

function DisabledProvidersDialog({ open, onOpenChange }: { open?: boolean, onOpenChange?: (open: boolean) => void }) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const oauthProviders = project.config.oauthProviders;
  const [providerSearch, setProviderSearch] = useState("");
  const filteredProviders = allProviders
    .filter((id) => id.toLowerCase().includes(providerSearch.toLowerCase()))
    .map((id) => [id, oauthProviders.find((provider) => provider.id === id)] as const)
    .filter(([, provider]) => {
      return !provider?.enabled;
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
              const alreadyExist = oauthProviders.some((p) => p.id === id);
              const newOAuthProviders = oauthProviders.map((p) => p.id === id ? provider : p);
              if (!alreadyExist) {
                newOAuthProviders.push(provider);
              }
              await project.update({
                config: { oauthProviders: newOAuthProviders },
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
  const project = stackAdminApp.useProject();
  const oauthProviders = project.config.oauthProviders;
  const [turnOffProviderDialogOpen, setTurnOffProviderDialogOpen] = useState(false);
  const [providerSettingDialogOpen, setProviderSettingDialogOpen] = useState(false);


  const updateProvider = async (provider: AdminOAuthProviderConfig & OAuthProviderConfig) => {
    const alreadyExist = oauthProviders.some((p) => p.id === config.id);
    const newOAuthProviders = oauthProviders.map((p) => p.id === config.id ? provider : p);
    if (!alreadyExist) {
      newOAuthProviders.push(provider);
    }
    await project.update({
      config: { oauthProviders: newOAuthProviders },
    });
  };

  return (
    <DropdownMenu>
      <TurnOffProviderDialog
        open={turnOffProviderDialogOpen}
        onClose={() => setTurnOffProviderDialogOpen(false)}
        providerId={config.id}
        onConfirm={async () => {
          await updateProvider({
            ...config,
            id: config.id,
            enabled: false
          });
        }}
      />
      <ProviderSettingDialog
        id={config.id}
        open={providerSettingDialogOpen}
        onClose={() => setProviderSettingDialogOpen(false)}
        updateProvider={updateProvider}
      />

      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-8 w-8 p-0">
          <span className="sr-only">Open menu</span>
          <MoreHorizontal className="h-4 w-4" />
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
  const oauthProviders = project.config.oauthProviders;
  const [confirmSignUpEnabled, setConfirmSignUpEnabled] = useState(false);
  const [confirmSignUpDisabled, setConfirmSignUpDisabled] = useState(false);
  const [disabledProvidersDialogOpen, setDisabledProvidersDialogOpen] = useState(false);

  const enabledProviders = allProviders
    .map((id) => [id, oauthProviders.find((provider) => provider.id === id)] as const)
    .filter(([, provider]) => provider?.enabled);

  return (
    <PageLayout title="Auth Methods" description="Configure how users can sign in to your app">
      <div className="flex gap-4">
        <SettingCard className="flex-grow">
          <SettingSwitch
            label={
              <div className="flex items-center gap-2">
                <AsteriskSquare size={20} aria-hidden="true" />
                <span>Email/password authentication</span>
              </div>
            }
            checked={project.config.credentialEnabled}
            onCheckedChange={async (checked) => {
              await project.update({
                config: {
                  credentialEnabled: checked,
                },
              });
            }}
          />
          <SettingSwitch
            label={
              <div className="flex items-center gap-2">
                <Link2 size={20} />
                <span>Magic link (Email OTP)</span>
              </div>
            }
            checked={project.config.magicLinkEnabled}
            onCheckedChange={async (checked) => {
              await project.update({
                config: {
                  magicLinkEnabled: checked,
                },
              });
            }}
          />
          <SettingSwitch
            label={
              <div className="flex items-center gap-2">
                <Key size={20} />
                <span>Passkey</span>
              </div>
            }
            checked={project.config.passkeyEnabled}
            onCheckedChange={async (checked) => {
              await project.update({
                config: {
                  passkeyEnabled: checked,
                },
              });
            }}
          />
          <CardSubtitle className="mt-2">
            SSO Providers
          </CardSubtitle>

          {enabledProviders.map(([, provider]) => provider)
            .filter((provider): provider is AdminOAuthProviderConfig => !!provider).map(provider => {
              return <div key={provider.id} className="flex h-10 items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="flex items-center justify-center w-12 h-12 rounded-md border border-gray-800"
                    style={{ backgroundColor: BrandIcons.BRAND_COLORS[provider.id] ?? undefined }}
                  >
                    <BrandIcons.Mapping iconSize={24} provider={provider.id} />
                  </div>
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
            <CirclePlus size={16}/>
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
                  <div className='w-full sm:max-w-xs m-auto scale-90 pointer-events-none' inert=''>
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
          checked={project.config.signUpEnabled}
          onCheckedChange={async (checked) => {
            if (checked) {
              setConfirmSignUpEnabled(true);
            } else {
              setConfirmSignUpDisabled(true);
            }
          }}
          hint="Existing users can still sign in when sign-up is disabled. You can always create new accounts manually via the dashboard."
        />
        <SettingSelect
          label="Sign-up mode when logging in with same email on multiple providers"
          value={project.config.oauthAccountMergeStrategy}
          onValueChange={async (value) => {
            await project.update({
              config: {
                oauthAccountMergeStrategy: value as OAuthAccountMergeStrategy,
              },
            });
          }}
          hint="Determines what happens when a user tries to sign in with a different OAuth provider using the same email address"
        >
          <SelectItem value="link_method">Link - Connect multiple providers to the same account</SelectItem>
          <SelectItem value="allow_duplicates">Allow - Create separate accounts for each provider</SelectItem>
          <SelectItem value="raise_error">Block - Show an error and prevent sign-in with multiple providers</SelectItem>
        </SettingSelect>
      </SettingCard>

      <SettingCard title="User deletion">
        <SettingSwitch
          label="Allow users to delete their own accounts on the client-side"
          checked={project.config.clientUserDeletionEnabled}
          onCheckedChange={async (checked) => {
            await project.update({
              config: {
                clientUserDeletionEnabled: checked,
              },
            });
          }}
        />
        <Typography variant="secondary" type="footnote">
          A delete button will also be added to the account settings page.
        </Typography>
      </SettingCard>

      <ConfirmSignUpEnabledDialog
        open={confirmSignUpEnabled}
        onOpenChange={setConfirmSignUpEnabled}
      />
      <ConfirmSignUpDisabledDialog
        open={confirmSignUpDisabled}
        onOpenChange={setConfirmSignUpDisabled}
      />
    </PageLayout>
  );
}
