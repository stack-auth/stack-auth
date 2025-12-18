"use client";
import { StyledLink } from "@/components/link";
import { SettingCard, SettingSwitch } from "@/components/settings";
import { Typography } from "@/components/ui";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();

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
            checked={project.config.allowUserApiKeys}
            onCheckedChange={async (checked) => {
              await project.update({
                config: {
                  allowUserApiKeys: checked
                }
              });
            }}
          />
          <Typography variant="secondary" type="footnote">
            Enable to allow users to create API keys for their accounts. Enables user-api-keys backend routes.
          </Typography>

          <SettingSwitch
            label="Allow Team API Keys"
            checked={project.config.allowTeamApiKeys}
            onCheckedChange={async (checked) => {
              await project.update({
                config: {
                  allowTeamApiKeys: checked
                }
              });
            }}
          />
          <Typography variant="secondary" type="footnote">
            Enable to allow users to create API keys for their teams. Enables team-api-keys backend routes.
          </Typography>
        </SettingCard>
      </PageLayout>
    </AppEnabledGuard>
  );
}
