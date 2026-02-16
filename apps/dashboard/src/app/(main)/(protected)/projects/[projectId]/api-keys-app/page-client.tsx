"use client";
import { StyledLink } from "@/components/link";
import {
  DesignAlert,
  DesignCard,
  DesignEditableGrid,
  type DesignEditableGridItem,
} from "@/components/design-components";
import { Switch } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { GearSix, KeyIcon, UsersIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  const [localUserApiKeys, setLocalUserApiKeys] = useState<boolean | undefined>(undefined);
  const [localTeamApiKeys, setLocalTeamApiKeys] = useState<boolean | undefined>(undefined);

  const userApiKeysEnabled = localUserApiKeys ?? config.apiKeys.enabled.user;
  const teamApiKeysEnabled = localTeamApiKeys ?? config.apiKeys.enabled.team;

  const hasChanges = useMemo(() =>
    localUserApiKeys !== undefined || localTeamApiKeys !== undefined,
  [localUserApiKeys, localTeamApiKeys]);

  const modifiedKeys = useMemo(() => new Set([
    ...(localUserApiKeys !== undefined ? ["user-api-keys"] : []),
    ...(localTeamApiKeys !== undefined ? ["team-api-keys"] : []),
  ]), [localUserApiKeys, localTeamApiKeys]);

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

  const apiKeyItems: DesignEditableGridItem[] = [
    {
      itemKey: "user-api-keys",
      type: "custom",
      icon: <KeyIcon className="h-3.5 w-3.5" />,
      name: "User API Keys",
      tooltip: "Allow users to create API keys for their accounts. Enables user-api-keys backend routes.",
      children: (
        <Switch
          checked={userApiKeysEnabled}
          onCheckedChange={(checked) => {
            if (checked === config.apiKeys.enabled.user) {
              setLocalUserApiKeys(undefined);
            } else {
              setLocalUserApiKeys(checked);
            }
          }}
        />
      ),
    },
    {
      itemKey: "team-api-keys",
      type: "custom",
      icon: <UsersIcon className="h-3.5 w-3.5" />,
      name: "Team API Keys",
      tooltip: "Allow users to create API keys for their teams. Enables team-api-keys backend routes.",
      children: (
        <Switch
          checked={teamApiKeysEnabled}
          onCheckedChange={(checked) => {
            if (checked === config.apiKeys.enabled.team) {
              setLocalTeamApiKeys(undefined);
            } else {
              setLocalTeamApiKeys(checked);
            }
          }}
        />
      ),
    },
  ];

  return (
    <AppEnabledGuard appId="api-keys">
      <PageLayout title="API Keys" description="Configure API key settings for your project">
        <DesignAlert variant="info" title="About API Keys">
          This app allows your users to create API keys for their accounts and teams. It is helpful if you have your own API that you would like to secure with Stack Auth.
          <br /><br />
          If you are looking to create or manage keys for your Stack Auth project, head over to the <StyledLink href={`/projects/${project.id}/project-keys`}>Project Keys</StyledLink> settings.
          <br /><br />
          For more information, see the <StyledLink href="https://docs.stack-auth.com/docs/apps/api-keys">API Keys docs</StyledLink>.
        </DesignAlert>

        <DesignCard
          title="API Key Settings"
          subtitle="Configure which types of API keys are allowed in your project"
          icon={GearSix}
          glassmorphic
        >
          <DesignEditableGrid
            items={apiKeyItems}
            columns={1}
            deferredSave
            hasChanges={hasChanges}
            onSave={handleSave}
            onDiscard={handleDiscard}
            externalModifiedKeys={modifiedKeys}
          />
        </DesignCard>
      </PageLayout>
    </AppEnabledGuard>
  );
}
