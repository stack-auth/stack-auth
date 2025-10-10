"use client";
import { InputField } from "@/components/form-fields";
import { StyledLink } from "@/components/link";
import { LogoUpload } from "@/components/logo-upload";
import { FormSettingCard, SettingCard, SettingSwitch, SettingText } from "@/components/settings";
import { getPublicEnvVar } from '@/lib/env';
import { TeamSwitcher, useUser } from "@stackframe/stack";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { ActionDialog, Alert, Button, Typography } from "@stackframe/stack-ui";
import { useTranslations } from 'next-intl';
import { useState } from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

const projectInformationSchema = yup.object().shape({
  displayName: yup.string().defined(),
  description: yup.string(),
});

export default function PageClient() {
  const t = useTranslations('projectSettings');
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const productionModeErrors = project.useProductionModeErrors();
  const user = useUser({ or: 'redirect', projectIdMustMatch: "internal" });
  const teams = user.useTeams();
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);

  // Get current owner team
  const currentOwnerTeam = teams.find(team => team.id === project.ownerTeamId) ?? throwErr(`Owner team of project ${project.id} not found in user's teams?`, { projectId: project.id, teams });

  // Check if user has team_admin permission for the current team
  const hasAdminPermissionForCurrentTeam = user.usePermission(currentOwnerTeam, "team_admin");

  // Check if user has team_admin permission for teams
  // We'll check permissions in the backend, but for UI we can check if user is in the team
  const selectedTeam = teams.find(team => team.id === selectedTeamId);

  const handleTransfer = async () => {
    if (!selectedTeamId || selectedTeamId === project.ownerTeamId) return;

    setIsTransferring(true);
    try {
      await project.transfer(user, selectedTeamId);

      // Reload the page to reflect changes
      // we don't actually need this, but it's a nicer UX as it clearly indicates to the user that a "big" change was made
      window.location.reload();
    } catch (error) {
      console.error('Failed to transfer project:', error);
      alert(t('transfer.error', { message: error instanceof Error ? error.message : 'Unknown error' }));
    } finally {
      setIsTransferring(false);
    }
  };

  return (
    <PageLayout title={t('title')} description={t('description')}>
      <SettingCard
        title={t('information.title')}
      >
        <SettingText label={t('information.projectId')}>
          {project.id}
        </SettingText>

        <SettingText label={t('information.jwksUrl')}>
          {`${getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL')}/api/v1/projects/${project.id}/.well-known/jwks.json`}
        </SettingText>
      </SettingCard>
      <FormSettingCard
        title={t('details.title')}
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
              label={t('details.displayName')}
              control={form.control}
              name="displayName"
              required
            />
            <InputField
              label={t('details.description')}
              control={form.control}
              name="description"
            />

            <Typography variant="secondary" type="footnote">
              {t('details.hint')}
            </Typography>
          </>
        )}
      />

      <SettingCard title={t('logo.title')}>
        <LogoUpload
          label={t('logo.logo')}
          value={project.logoUrl}
          onValueChange={async (logoUrl) => {
            await project.update({ logoUrl });
          }}
          description={t('logo.logoDesc')}
          type="logo"
        />

        <LogoUpload
          label={t('logo.fullLogo')}
          value={project.fullLogoUrl}
          onValueChange={async (fullLogoUrl) => {
            await project.update({ fullLogoUrl });
          }}
          description={t('logo.fullLogoDesc')}
          type="full-logo"
        />

        <Typography variant="secondary" type="footnote">
          {t('logo.hint')}
        </Typography>
      </SettingCard>

      <SettingCard
        title={t('apiKeys.title')}
        description={t('apiKeys.description')}
      >
        <SettingSwitch
          label={t('apiKeys.allowUserKeys')}
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
          {t('apiKeys.userKeysHint')}
        </Typography>

        <SettingSwitch
          label={t('apiKeys.allowTeamKeys')}
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
          {t('apiKeys.teamKeysHint')}
        </Typography>


      </SettingCard>

      <SettingCard
        title={t('productionMode.title')}
        description={t('productionMode.description')}
      >
        <SettingSwitch
          label={t('productionMode.enableLabel')}
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
            {t('productionMode.ready')}
          </Alert>
        ) : (
          <Alert variant="destructive">
            {t('productionMode.notReady')}
            <ul className="mt-2 list-disc pl-5">
              {productionModeErrors.map((error) => (
                <li key={error.message}>
                  {error.message} (<StyledLink href={error.relativeFixUrl}>{t('productionMode.showConfig')}</StyledLink>)
                </li>
              ))}
            </ul>
          </Alert>
        )}
      </SettingCard>

      <SettingCard
        title={t('transfer.title')}
        description={t('transfer.description')}
      >
        <div className="flex flex-col gap-4">
          {!hasAdminPermissionForCurrentTeam ? (
            <Alert variant="destructive">
              {t('transfer.needAdmin', { teamName: currentOwnerTeam.displayName || t('transfer.currentTeam') })}
            </Alert>
          ) : (
            <>
              <div>
                <Typography variant="secondary" className="mb-2">
                  {t('transfer.currentOwner', { teamName: currentOwnerTeam.displayName || t('transfer.unknown') })}
                </Typography>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
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
                      disabled={!selectedTeam || isTransferring}
                    >
                      {t('transfer.button')}
                    </Button>
                  }
                  title={t('transfer.dialogTitle')}
                  okButton={{
                    label: t('transfer.dialogButton'),
                    onClick: handleTransfer
                  }}
                  cancelButton
                >
                  <Typography>
                    {t('transfer.confirm', {
                      projectName: project.displayName,
                      teamName: teams.find(t => t.id === selectedTeamId)?.displayName
                    })}
                  </Typography>
                  <Typography className="mt-2" variant="secondary">
                    {t('transfer.warning')}
                  </Typography>
                </ActionDialog>
              </div>
            </>
          )}
        </div>
      </SettingCard>

      <SettingCard
        title={t('dangerZone.title')}
        description={t('dangerZone.description')}
        className="border-destructive"
      >
        <div className="flex flex-col gap-4">
          <div>
            <Typography variant="secondary" className="mb-2">
              {t('dangerZone.warning')}
            </Typography>
            <ActionDialog
              trigger={
                <Button variant="destructive" size="sm">
                  {t('dangerZone.deleteButton')}
                </Button>
              }
              title={t('dangerZone.dialogTitle')}
              danger
              okButton={{
                label: t('dangerZone.dialogButton'),
                onClick: async () => {
                  await project.delete();
                  await stackAdminApp.redirectToHome();
                }
              }}
              cancelButton
              confirmText={t('dangerZone.confirmText')}
            >
              <Typography>
                {t('dangerZone.confirmMessage', {
                  projectName: project.displayName,
                  projectId: project.id
                })}
              </Typography>
              <Typography className="mt-2">
                {t('dangerZone.irreversible')} <strong>{t('dangerZone.irreversibleBold')}</strong> {t('dangerZone.willDelete')}
              </Typography>
              <ul className="mt-2 list-disc pl-5">
                <li>{t('dangerZone.deleteItems.users')}</li>
                <li>{t('dangerZone.deleteItems.teams')}</li>
                <li>{t('dangerZone.deleteItems.apiKeys')}</li>
                <li>{t('dangerZone.deleteItems.configs')}</li>
                <li>{t('dangerZone.deleteItems.oauth')}</li>
              </ul>
            </ActionDialog>
          </div>
        </div>
      </SettingCard>
    </PageLayout>
  );
}
