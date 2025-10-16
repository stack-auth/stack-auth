"use client";
import { InputField } from "@/components/form-fields";
import { Link, StyledLink } from "@/components/link";
import { LogoUpload } from "@/components/logo-upload";
import { FormSettingCard, SettingCard, SettingSwitch, SettingText } from "@/components/settings";
import { getPublicEnvVar } from "@/lib/env";
import { TeamSwitcher, useUser } from "@stackframe/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { ActionDialog, Alert, Avatar, AvatarFallback, AvatarImage, Button, SimpleTooltip, Typography } from "@stackframe/stack-ui";
import { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

const projectInformationSchema = yup.object().shape({
  displayName: yup.string().defined(),
  description: yup.string(),
});

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const productionModeErrors = project.useProductionModeErrors();
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  const teams = user.useTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const baseApiUrl = getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL');
  const jwksUrl = `${baseApiUrl}/api/v1/projects/${project.id}/.well-known/jwks.json`;
  const anonymousJwksUrl = `${jwksUrl}?include_anonymous=true`;

  const renderInfoLabel = (label: string, tooltip: string) => (
    <div className="flex items-center gap-2">
      <span>{label}</span>
      <SimpleTooltip type="info" tooltip={tooltip}>
        <span className="sr-only">{`More info about ${label}`}</span>
      </SimpleTooltip>
    </div>
  );

  // Get current owner team
  const currentOwnerTeam = teams.find(team => team.id === project.ownerTeamId) ?? throwErr(`Owner team of project ${project.id} not found in user's teams?`, { projectId: project.id, teams });

  // Check if user has team_admin permission for the current team
  const hasAdminPermissionForCurrentTeam = user.usePermission(currentOwnerTeam, "team_admin");

  // Check if user has team_admin permission for teams
  // We'll check permissions in the backend, but for UI we can check if user is in the team
  const selectedTeam = teams.find(team => team.id === selectedTeamId);
  const currentTeamMembers = currentOwnerTeam.useUsers();
  const teamSettingsPath = `/projects?team_settings=${encodeURIComponent(currentOwnerTeam.id)}`;

  const handleTransfer = async () => {
    if (!selectedTeamId || selectedTeamId === project.ownerTeamId) return;

    setIsTransferring(true);
    try {
      await user.transferProject(project.id, selectedTeamId);

      // Reload the page to reflect changes
      // we don't actually need this, but it's a nicer UX as it clearly indicates to the user that a "big" change was made
      window.location.reload();
    } catch (error) {
      console.error('Failed to transfer project:', error);
      alert(`Failed to transfer project: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <PageLayout title="Project Settings" description="Manage your project">
      <SettingCard
        title="Project Information"
      >
        <SettingText label="Project ID">
          {project.id}
        </SettingText>

        <SettingText label={renderInfoLabel("JWKS URL", "Use this url to allow other services to verify Stack Auth-issued sessions for this project.")}>
          {jwksUrl}
        </SettingText>

        <SettingText label={renderInfoLabel("Anonymous JWKS URL", "Includes keys for anonymous sessions when you treat them as authenticated users.")}>
          {anonymousJwksUrl}
        </SettingText>
      </SettingCard>
      <FormSettingCard
        title="Project Details"
        defaultValues={{
          displayName: project.displayName,
          description: project.description || undefined,
        }}
        formSchema={projectInformationSchema}
        onSubmit={async (values) => {
          await project.update(values);
        }}
        render={(form) => (
          <>
            <InputField
              label="Display Name"
              control={form.control}
              name="displayName"
              required
            />
            <InputField
              label="Description"
              control={form.control}
              name="description"
            />

            <Typography variant="secondary" type="footnote">
              The display name and description may be publicly visible to the
              users of your app.
            </Typography>
          </>
        )}
      />

      <SettingCard title="Project Logo">
        <LogoUpload
          label="Logo"
          value={project.logoUrl}
          onValueChange={async (logoUrl) => {
            await project.update({ logoUrl });
          }}
          description="Upload a logo for your project. Recommended size: 200x200px"
          type="logo"
        />

        <LogoUpload
          label="Full Logo"
          value={project.fullLogoUrl}
          onValueChange={async (fullLogoUrl) => {
            await project.update({ fullLogoUrl });
          }}
          description="Upload a full logo with text. Recommended size: At least 100px tall, landscape format"
          type="full-logo"
        />

        <Typography variant="secondary" type="footnote">
          Logo images will be displayed in your application (e.g. login page) and emails. The logo should be a square image, while the full logo can include text and be wider.
        </Typography>
      </SettingCard>

      <SettingCard
        title="Project Access"
        description="See who can manage this project and transfer ownership if needed."
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Typography className="text-base font-semibold">
              {currentOwnerTeam.displayName || "Unnamed team"}
            </Typography>
            <Typography variant="secondary" type="footnote">
              Everyone in this team can access and manage the project.
            </Typography>
          </div>

          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <Typography variant="secondary">
                Team members
              </Typography>
              <Button asChild variant="secondary" size="sm">
                <Link href={teamSettingsPath}>
                  Manage team members
                </Link>
              </Button>
            </div>
            {currentTeamMembers.length === 0 ? (
              <div className="rounded-lg border border-border/50 bg-muted/40 p-4">
                <Typography variant="secondary" type="footnote">
                  This team has no members yet.
                </Typography>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-card">
                <ul className="divide-y divide-border/60">
                  {currentTeamMembers.map((member) => {
                    const displayName = member.teamProfile.displayName?.trim() || "Name not set";
                    const avatarFallback = displayName === "Name not set"
                      ? "?"
                      : displayName.charAt(0).toUpperCase();
                    return (
                      <li key={member.id} className="flex items-center gap-3 p-3">
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={member.teamProfile.profileImageUrl || undefined} alt={displayName} />
                          <AvatarFallback>{avatarFallback}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <Typography className="font-medium">
                            {displayName}
                          </Typography>
                          {displayName === "Name not set" && (
                            <Typography variant="secondary" type="footnote">
                              Display name not set
                            </Typography>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <Typography variant="secondary" type="footnote">
              Invite new people or adjust roles in the team settings page.
            </Typography>
          </div>

          <div className="flex flex-col gap-3">
            <Typography variant="secondary">
              Transfer to a different team
            </Typography>
            {!hasAdminPermissionForCurrentTeam ? (
              <Alert variant="destructive">
                {`You need to be a team admin of "${currentOwnerTeam.displayName || 'the current team'}" to transfer this project.`}
              </Alert>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row">
                <div className="sm:w-full sm:max-w-sm">
                  <TeamSwitcher
                    triggerClassName="w-full"
                    teamId={selectedTeamId || ""}
                    onChange={async (team) => {
                      setSelectedTeamId(team.id);
                    }}
                  />
                </div>
                <ActionDialog
                  trigger={
                    <Button
                      variant="secondary"
                      disabled={
                        !selectedTeam ||
                        selectedTeam.id === project.ownerTeamId ||
                        isTransferring
                      }
                    >
                      Transfer
                    </Button>
                  }
                  title="Transfer Project"
                  okButton={{
                    label: "Transfer Project",
                    onClick: handleTransfer
                  }}
                  cancelButton
                >
                  <Typography>
                    {`Are you sure you want to transfer "${project.displayName}" to ${teams.find(t => t.id === selectedTeamId)?.displayName}?`}
                  </Typography>
                  <Typography className="mt-2" variant="secondary">
                    This will change the ownership of the project. Only team admins of the new team will be able to manage project settings.
                  </Typography>
                </ActionDialog>
              </div>
            )}
          </div>
        </div>
      </SettingCard>

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

      <SettingCard
        title="Production mode"
        description="Production mode disallows certain configuration options that are useful for development but deemed unsafe for production usage. To prevent accidental misconfigurations, it is strongly recommended to enable production mode on your production environments."
      >
        <SettingSwitch
          label="Enable production mode"
          checked={project.isProductionMode}
          disabled={
            !project.isProductionMode && productionModeErrors.length > 0
          }
          onCheckedChange={async (checked) => {
            await project.update({ isProductionMode: checked });
          }}
        />

        {productionModeErrors.length === 0 ? (
          <Alert>
            Your configuration is ready for production and production mode can
            be enabled. Good job!
          </Alert>
        ) : (
          <Alert variant="destructive">
            Your configuration is not ready for production mode. Please fix the
            following issues:
            <ul className="mt-2 list-disc pl-5">
              {productionModeErrors.map((error) => (
                <li key={error.message}>
                  {error.message} (<StyledLink href={error.relativeFixUrl}>show configuration</StyledLink>)
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </SettingCard>

      <SettingCard
        title="Danger Zone"
        description="Irreversible and destructive actions"
        className="border-destructive"
      >
        <div className="flex flex-col gap-4">
          <div>
            <Typography variant="secondary" className="mb-2">
              Once you delete a project, there is no going back. All data will be permanently removed.
            </Typography>
            <ActionDialog
              trigger={
                <Button variant="destructive" size="sm">
                  Delete Project
                </Button>
              }
              title="Delete Project"
              danger
              okButton={{
                label: "Delete Project",
                onClick: async () => {
                  await project.delete();
                  await stackAdminApp.redirectToHome();
                }
              }}
              cancelButton
              confirmText="I understand this action is IRREVERSIBLE and will delete ALL associated data."
            >
              <Typography>
                {`Are you sure that you want to delete the project with name "${project.displayName}" and ID "${project.id}"?`}
              </Typography>
              <Typography className="mt-2">
                This action is <strong>irreversible</strong> and will permanently delete:
              </Typography>
              <ul className="mt-2 list-disc pl-5">
                <li>All users and their data</li>
                <li>All teams and team memberships</li>
                <li>All API keys</li>
                <li>All project configurations</li>
                <li>All OAuth provider settings</li>
              </ul>
            </ActionDialog>
          </div>
        </div>
      </SettingCard>
    </PageLayout>
  );
}
