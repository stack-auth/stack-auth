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

/**
 * @dashboardReference api-keys/api-keys
 * @dashboardReferenceDescription Configure whether users and teams can create their own API keys.
 *
 * The **API Keys** app controls whether your end users may create API keys scoped to their own account or to teams they belong to.
 *
 * ## About this page
 *
 * This page is **not** where you manage Hexclave **project keys** (publishable client keys and secret server keys for calling the Stack API). Use **Project Keys** in project settings for that.
 *
 * The info alert at the top links to the public [API Keys guide](https://docs.hexclave.com/docs/apps/api-keys) for SDK integration details.
 *
 * ## API Key Settings
 *
 * Two toggles sit in a deferred-save grid (edit, then **Save** or **Discard**):
 *
 * - **User API Keys** — sets `apiKeys.enabled.user`. When enabled, users can create API keys for their accounts and the user-api-keys backend routes are available.
 * - **Team API Keys** — sets `apiKeys.enabled.team`. When enabled, users can create API keys for teams they belong to and the team-api-keys backend routes are available.
 *
 * Both can be on at the same time. Turning one off does not delete existing keys; it prevents new key creation through those scopes.
 */
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
        <DesignAlert
          variant="info"
          title="About API Keys"
          description={<>
            This app allows your users to create API keys for their accounts and teams. It is helpful if you have your own API that you would like to secure with Hexclave.
            <br /><br />
            If you are looking to create or manage keys for your Hexclave project, head over to the <StyledLink href={`/projects/${project.id}/project-keys`}>Project Keys</StyledLink> settings.
            <br /><br />
            For more information, see the <StyledLink href="https://docs.hexclave.com/docs/apps/api-keys">API Keys docs</StyledLink>.
          </>}
        />

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
            className="gap-y-3"
          />
        </DesignCard>
      </PageLayout>
    </AppEnabledGuard>
  );
}
