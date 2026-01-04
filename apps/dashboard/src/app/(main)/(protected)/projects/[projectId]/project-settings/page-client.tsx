"use client";
import { InputField } from "@/components/form-fields";
import { Link, StyledLink } from "@/components/link";
import { LogoUpload } from "@/components/logo-upload";
import { FormSettingCard, SettingCard, SettingCopyableText, SettingSwitch } from "@/components/settings";
import { ActionDialog, Alert, Avatar, AvatarFallback, AvatarImage, Button, SimpleTooltip, Typography, useToast } from "@/components/ui";
import { getPublicEnvVar } from "@/lib/env";
import type { PushedConfigSource } from "@stackframe/stack";
import { TeamSwitcher, useUser } from "@stackframe/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { runAsynchronouslyWithAlert } from "@stackframe/stack-shared/dist/utils/promises";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

const projectInformationSchema = yup.object().shape({
  displayName: yup.string().defined(),
  description: yup.string(),
});

function TeamMemberItem({ member }: { member: any }) {
  const displayName = member.teamProfile.displayName?.trim() || "Name not set";
  const avatarFallback = displayName === "Name not set"
    ? "?"
    : displayName.charAt(0).toUpperCase();

  return (
    <li className="flex items-center gap-3 p-3">
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
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const productionModeErrors = project.useProductionModeErrors();
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  const teams = user.useTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [configSource, setConfigSource] = useState<PushedConfigSource | null>(null);
  const [isLoadingSource, setIsLoadingSource] = useState(true);
  const { toast } = useToast();

  // Fetch config source on mount
  useEffect(() => {
    runAsynchronouslyWithAlert(async () => {
      try {
        const source = await project.getPushedConfigSource();
        setConfigSource(source);
      } finally {
        setIsLoadingSource(false);
      }
    });
  }, [project]);

  const handleUnlinkSource = useCallback(async () => {
    await project.unlinkPushedConfigSource();
    setConfigSource({ type: "unlinked" });
    toast({ title: "Configuration source unlinked", description: "You can now edit the configuration directly on this dashboard." });
  }, [project, toast]);

  const baseApiUrl = getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL');

  // Memoize computed URLs
  const jwksUrl = useMemo(
    () => `${baseApiUrl}/api/v1/projects/${project.id}/.well-known/jwks.json`,
    [baseApiUrl, project.id]
  );

  const anonymousJwksUrl = useMemo(
    () => `${jwksUrl}?include_anonymous=true`,
    [jwksUrl]
  );

  // Memoize renderInfoLabel callback
  const renderInfoLabel = useCallback((label: string, tooltip: string) => (
    <div className="flex items-center gap-2">
      <span>{label}</span>
      <SimpleTooltip type="info" tooltip={tooltip}>
        <span className="sr-only">{`More info about ${label}`}</span>
      </SimpleTooltip>
    </div>
  ), []);

  // Memoize current owner team lookup
  const currentOwnerTeam = useMemo(
    () => teams.find(team => team.id === project.ownerTeamId) ?? throwErr(`Owner team of project ${project.id} not found in user's teams?`, { projectId: project.id, teams }),
    [teams, project.ownerTeamId, project.id]
  );

  // Check if user has team_admin permission for the current team
  const hasAdminPermissionForCurrentTeam = user.usePermission(currentOwnerTeam, "team_admin");

  // Memoize selected team lookup
  const selectedTeam = useMemo(
    () => teams.find(team => team.id === selectedTeamId),
    [teams, selectedTeamId]
  );

  const currentTeamMembers = currentOwnerTeam.useUsers();

  // Memoize team settings path
  const teamSettingsPath = useMemo(
    () => `/projects?team_settings=${encodeURIComponent(currentOwnerTeam.id)}`,
    [currentOwnerTeam.id]
  );

  const handleTransfer = useCallback(async () => {
    if (!selectedTeamId || selectedTeamId === project.ownerTeamId) return;
    if (isTransferring) return;

    setIsTransferring(true);
    try {
      await user.transferProject(project.id, selectedTeamId);

      toast({
        title: 'Project transferred successfully',
        variant: 'success'
      });

      // Reload the page to reflect changes
      // we don't actually need this, but it's a nicer UX as it clearly indicates to the user that a "big" change was made
      window.location.reload();
    } finally {
      setIsTransferring(false);
    }
  }, [selectedTeamId, project.ownerTeamId, project.id, user, toast, isTransferring]);

  // Memoize logo update callbacks
  const handleLogoChange = useCallback(async (logoUrl: string | null) => {
    await project.update({ logoUrl });
  }, [project]);

  const handleFullLogoChange = useCallback(async (logoFullUrl: string | null) => {
    await project.update({ logoFullUrl });
  }, [project]);

  // Memoize production mode change callback
  const handleProductionModeChange = useCallback(async (checked: boolean) => {
    await project.update({ isProductionMode: checked });
  }, [project]);

  // Memoize team switcher change callback
  const handleTeamSwitcherChange = useCallback(async (team: any) => {
    setSelectedTeamId(team.id);
  }, []);

  // Memoize project details submit callback
  const handleProjectDetailsSubmit = useCallback(async (values: any) => {
    await project.update(values);
  }, [project]);

  // Memoize project delete callback
  const handleProjectDelete = useCallback(async () => {
    await project.delete();
    await stackAdminApp.redirectToHome();
  }, [project, stackAdminApp]);

  return (
    <PageLayout title="Project Settings" description="Manage your project">
      <SettingCard
        title="Project Information"
      >
        <SettingCopyableText
          label="Project ID"
          value={project.id}
        />

        <span className="text-xs text-muted-foreground">
          NOTE: Looking for project API keys? Head over to the <StyledLink href={`/projects/${project.id}/project-keys`}>Project Keys</StyledLink> page.
        </span>

        <SettingCopyableText
          label={renderInfoLabel("JWKS URL", "Use this url to allow other services to verify Stack Auth-issued sessions for this project.")}
          value={jwksUrl}
        />

        <SettingCopyableText
          label={renderInfoLabel("Anonymous JWKS URL", "Includes keys for anonymous sessions when you treat them as authenticated users.")}
          value={anonymousJwksUrl}
        />
      </SettingCard>
      <FormSettingCard
        title="Project Details"
        defaultValues={{
          displayName: project.displayName,
          description: project.description || undefined,
        }}
        formSchema={projectInformationSchema}
        onSubmit={handleProjectDetailsSubmit}
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
          onValueChange={handleLogoChange}
          description="Upload a logo for your project. Recommended size: 200x200px"
          type="logo"
        />

        <LogoUpload
          label="Full Logo"
          value={project.logoFullUrl}
          onValueChange={handleFullLogoChange}
          description="Upload a full logo with text. Recommended size: At least 100px tall, landscape format"
          type="full-logo"
        />

        <LogoUpload
          label="Logo (Dark Mode)"
          value={project.logoDarkModeUrl}
          onValueChange={async (logoDarkModeUrl) => {
            await project.update({ logoDarkModeUrl });
          }}
          description="Upload a dark mode version of your logo. Recommended size: 200x200px"
          type="logo"
        />

        <LogoUpload
          label="Full Logo (Dark Mode)"
          value={project.logoFullDarkModeUrl}
          onValueChange={async (logoFullDarkModeUrl) => {
            await project.update({ logoFullDarkModeUrl });
          }}
          description="Upload a dark mode version of your full logo. Recommended size: At least 100px tall, landscape format"
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
                  {currentTeamMembers.map((member) => (
                    <TeamMemberItem key={member.id} member={member} />
                  ))}
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
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-2">
                <TeamSwitcher
                  triggerClassName="w-full sm:w-96"
                  teamId={selectedTeamId || ""}
                  onChange={handleTeamSwitcherChange}
                />
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
                    {`Are you sure you want to transfer "${project.displayName}" to ${selectedTeam?.displayName}?`}
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
        title="Production mode"
        description="Production mode disallows certain configuration options that are useful for development but deemed unsafe for production usage. To prevent accidental misconfigurations, it is strongly recommended to enable production mode on your production environments."
      >
        <SettingSwitch
          label="Enable production mode"
          checked={project.isProductionMode}
          disabled={
            !project.isProductionMode && productionModeErrors.length > 0
          }
          onCheckedChange={handleProductionModeChange}
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
        title="Configuration Source"
        description="Manage where your project configuration is managed from."
      >
        {isLoadingSource ? (
          <Typography variant="secondary">Loading...</Typography>
        ) : configSource?.type === "unlinked" ? (
          <div className="flex flex-col gap-2">
            <Typography>
              <strong>Dashboard</strong>
            </Typography>
            <Typography variant="secondary" type="footnote">
              Your configuration is managed directly on this dashboard. Changes take effect immediately when saved.
            </Typography>
          </div>
        ) : configSource?.type === "pushed-from-github" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Typography>
                <strong>GitHub</strong>
              </Typography>
              <Typography variant="secondary" type="footnote">
                Your configuration is managed via GitHub. Changes made on this dashboard will be overwritten when you push from GitHub again.
              </Typography>
              <div className="mt-2 p-3 bg-muted rounded-md text-sm space-y-1">
                <div><strong>Repository:</strong> {configSource.owner}/{configSource.repo}</div>
                <div><strong>Branch:</strong> {configSource.branch}</div>
                <div><strong>Config file:</strong> {configSource.configFilePath}</div>
                <div><strong>Last commit:</strong> <code className="text-xs">{configSource.commitHash.substring(0, 7)}</code></div>
              </div>
            </div>
            <div>
              <ActionDialog
                trigger={
                  <Button variant="secondary" size="sm">
                    Unlink from GitHub
                  </Button>
                }
                title="Unlink Configuration Source"
                okButton={{
                  label: "Unlink",
                  onClick: handleUnlinkSource,
                }}
                cancelButton
              >
                <Typography>
                  Are you sure you want to unlink your configuration from GitHub?
                </Typography>
                <Typography className="mt-2" variant="secondary">
                  After unlinking, you can edit the configuration directly on this dashboard. However, pushing from GitHub will no longer update your configuration until you reconnect.
                </Typography>
              </ActionDialog>
            </div>
          </div>
        ) : configSource?.type === "pushed-from-unknown" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Typography>
                <strong>CLI</strong>
              </Typography>
              <Typography variant="secondary" type="footnote">
                Your configuration was pushed via the Stack Auth CLI. Changes made on this dashboard will be overwritten when you push from the CLI again.
              </Typography>
            </div>
            <div>
              <ActionDialog
                trigger={
                  <Button variant="secondary" size="sm">
                    Unlink from CLI
                  </Button>
                }
                title="Unlink Configuration Source"
                okButton={{
                  label: "Unlink",
                  onClick: handleUnlinkSource,
                }}
                cancelButton
              >
                <Typography>
                  Are you sure you want to unlink your configuration from the CLI?
                </Typography>
                <Typography className="mt-2" variant="secondary">
                  After unlinking, you can edit the configuration directly on this dashboard. However, pushing from the CLI will no longer update your configuration until you reconnect.
                </Typography>
              </ActionDialog>
            </div>
          </div>
        ) : (
          <Typography variant="secondary">Unknown configuration source</Typography>
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
                onClick: handleProjectDelete
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
