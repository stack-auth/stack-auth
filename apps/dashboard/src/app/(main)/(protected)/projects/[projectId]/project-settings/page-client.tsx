"use client";
import { InputField } from "@/components/form-fields";
import { StyledLink } from "@/components/link";
import { LogoUpload } from "@/components/logo-upload";
import { FormSettingCard, SettingCard, SettingSwitch, SettingText } from "@/components/settings";
import { getPublicEnvVar } from '@/lib/env';
import { ActionDialog, Alert, Button, Typography } from "@stackframe/stack-ui";
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

  return (
    <PageLayout title="Project Settings" description="Manage your project">
      <SettingCard
        title="Project Information"
      >
        <SettingText label="Project ID">
          {project.id}
        </SettingText>

        <SettingText label="JWKS URL">
          {`${getPublicEnvVar('NEXT_PUBLIC_STACK_API_URL')}/api/v1/projects/${project.id}/.well-known/jwks.json`}
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
