"use client";
import { InlineSaveDiscard } from "@/components/inline-save-discard";
import { StyledLink } from "@/components/link";
import { SettingCard, SettingSwitch } from "@/components/settings";
import { Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  // Local state for API key settings
  const [localUserApiKeys, setLocalUserApiKeys] = useState<boolean | undefined>(undefined);
  const [localTeamApiKeys, setLocalTeamApiKeys] = useState<boolean | undefined>(undefined);

  const userApiKeysEnabled = localUserApiKeys ?? config.apiKeys.enabled.user;
  const teamApiKeysEnabled = localTeamApiKeys ?? config.apiKeys.enabled.team;

  const hasChanges = useMemo(() =>
    localUserApiKeys !== undefined || localTeamApiKeys !== undefined,
  [localUserApiKeys, localTeamApiKeys]);

  const handleSave = async () => {
    const configUpdate: Record<string, boolean> = {};
    if (localUserApiKeys !== undefined) {
      configUpdate['apiKeys.enabled.user'] = localUserApiKeys;
    }
    if (localTeamApiKeys !== undefined) {
      configUpdate['apiKeys.enabled.team'] = localTeamApiKeys;
    }
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate,
      pushable: true,
    });
    setLocalUserApiKeys(undefined);
    setLocalTeamApiKeys(undefined);
  };

  const handleDiscard = () => {
    setLocalUserApiKeys(undefined);
    setLocalTeamApiKeys(undefined);
  };

  return (
    <AppEnabledGuard appId="api-keys">
      <PageLayout title="API Keys" description="Configure API key settings for your project">
        <span className="bg-blue-500/10 p-4 rounded-lg border">
          Note: This app allows your users to create API keys for their accounts and teams. It is helpful if you have your own API that you would like to secure with Stack Auth.<br /><br />

          If you are looking to create or manage keys for your Stack Auth project, head over to the <StyledLink href={`/projects/${project.id}/project-keys`}>Project Keys</StyledLink> settings.<br /><br />

          For more information, see the <StyledLink href="https://docs.stack-auth.com/docs/apps/api-keys">API Keys docs</StyledLink>.
        </span>
        <SettingCard
          title="API Key Settings"
          description="Configure which types of API keys are allowed in your project."
        >
          <SettingSwitch
            label="Allow User API Keys"
            checked={userApiKeysEnabled}
            onCheckedChange={(checked) => {
              if (checked === config.apiKeys.enabled.user) {
                setLocalUserApiKeys(undefined);
              } else {
                setLocalUserApiKeys(checked);
              }
            }}
          />
          <Typography variant="secondary" type="footnote">
            Enable to allow users to create API keys for their accounts. Enables user-api-keys backend routes.
          </Typography>

          <SettingSwitch
            label="Allow Team API Keys"
            checked={teamApiKeysEnabled}
            onCheckedChange={(checked) => {
              if (checked === config.apiKeys.enabled.team) {
                setLocalTeamApiKeys(undefined);
              } else {
                setLocalTeamApiKeys(checked);
              }
            }}
          />
          <Typography variant="secondary" type="footnote">
            Enable to allow users to create API keys for their teams. Enables team-api-keys backend routes.
          </Typography>
          <InlineSaveDiscard
            hasChanges={hasChanges}
            onSave={handleSave}
            onDiscard={handleDiscard}
          />
        </SettingCard>
      </PageLayout>
    </AppEnabledGuard>
  );
}
