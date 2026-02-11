"use client";
import { SmartFormDialog } from "@/components/form-dialog";
import { InlineSaveDiscard } from "@/components/inline-save-discard";
import { PermissionListField } from "@/components/permission-field";
import { SettingCard, SettingSwitch } from "@/components/settings";
import { Badge, Button, Typography } from "@/components/ui";
import { useUpdateConfig } from "@/lib/config-update";
import { typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import { useMemo, useState } from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

function CreateDialog(props: {
  trigger: React.ReactNode,
  type: "creator" | "member",
}) {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const permissions = stackAdminApp.useTeamPermissionDefinitions();
  const updateConfig = useUpdateConfig();

  const defaultPermissions = props.type === "creator"
    ? config.rbac.defaultPermissions.teamCreator
    : config.rbac.defaultPermissions.teamMember;
  const selectedPermissionIds = Object.keys(defaultPermissions).filter(id => defaultPermissions[id]);

  const formSchema = yup.object({
    permissions: yup.array().of(yup.string().defined()).defined().meta({
      stackFormFieldRender: (props) => (
        <PermissionListField
          {...props}
          permissions={permissions}
          selectedPermissionIds={selectedPermissionIds}
          type="select"
          label="Default Permissions"
        />
      ),
    }).default(selectedPermissionIds),
  });

  return <SmartFormDialog
    trigger={props.trigger}
    title={props.type === "creator" ? "Team Creator Default Permissions" : "Team Member Default Permissions"}
    formSchema={formSchema}
    okButton={{ label: "Save" }}
    onSubmit={async (values) => {
      const permissionsMap = typedFromEntries(values.permissions.map((id) => [id, true]));
      const configKey = props.type === "creator"
        ? 'rbac.defaultPermissions.teamCreator'
        : 'rbac.defaultPermissions.teamMember';

      await updateConfig({
        adminApp: stackAdminApp,
        configUpdate: {
          [configKey]: permissionsMap,
        },
        pushable: true,
      });
    }}
    cancelButton
  />;
}

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const config = project.useConfig();
  const updateConfig = useUpdateConfig();

  // Local state for team settings
  const [localClientTeamCreation, setLocalClientTeamCreation] = useState<boolean | undefined>(undefined);
  const [localPersonalTeamOnSignUp, setLocalPersonalTeamOnSignUp] = useState<boolean | undefined>(undefined);

  const clientTeamCreation = localClientTeamCreation ?? config.teams.allowClientTeamCreation;
  const personalTeamOnSignUp = localPersonalTeamOnSignUp ?? config.teams.createPersonalTeamOnSignUp;

  const hasChanges = useMemo(() =>
    localClientTeamCreation !== undefined || localPersonalTeamOnSignUp !== undefined,
  [localClientTeamCreation, localPersonalTeamOnSignUp]);

  const handleSave = async () => {
    const configUpdate: Record<string, boolean> = {};
    if (localClientTeamCreation !== undefined) {
      configUpdate['teams.allowClientTeamCreation'] = localClientTeamCreation;
    }
    if (localPersonalTeamOnSignUp !== undefined) {
      configUpdate['teams.createPersonalTeamOnSignUp'] = localPersonalTeamOnSignUp;
    }
    await updateConfig({
      adminApp: stackAdminApp,
      configUpdate,
      pushable: true,
    });
    setLocalClientTeamCreation(undefined);
    setLocalPersonalTeamOnSignUp(undefined);
  };

  const handleDiscard = () => {
    setLocalClientTeamCreation(undefined);
    setLocalPersonalTeamOnSignUp(undefined);
  };

  const teamCreatorPermissions = Object.keys(config.rbac.defaultPermissions.teamCreator)
    .filter(id => config.rbac.defaultPermissions.teamCreator[id]);
  const teamMemberPermissions = Object.keys(config.rbac.defaultPermissions.teamMember)
    .filter(id => config.rbac.defaultPermissions.teamMember[id]);

  return (
    <AppEnabledGuard appId="teams">
      <PageLayout title="Team Settings">
        <SettingCard title="Team Creation Settings">
          <SettingSwitch
            label="Allow client users to create teams"
            checked={clientTeamCreation}
            onCheckedChange={(checked) => {
              if (checked === config.teams.allowClientTeamCreation) {
                setLocalClientTeamCreation(undefined);
              } else {
                setLocalClientTeamCreation(checked);
              }
            }}
          />
          <Typography variant="secondary" type="footnote">
            {'When enabled, a "Create Team" button will be added to the account settings page and the team switcher.'}
          </Typography>

          <div className="mt-4">
            <SettingSwitch
              label="Create a personal team for each user on sign-up"
              checked={personalTeamOnSignUp}
              onCheckedChange={(checked) => {
                if (checked === config.teams.createPersonalTeamOnSignUp) {
                  setLocalPersonalTeamOnSignUp(undefined);
                } else {
                  setLocalPersonalTeamOnSignUp(checked);
                }
              }}
            />
          </div>
          <Typography variant="secondary" type="footnote">
            When enabled, a personal team will be created for each user when they sign up. This will not automatically create teams for existing users.
          </Typography>
          <InlineSaveDiscard
            hasChanges={hasChanges}
            onSave={handleSave}
            onDiscard={handleDiscard}
          />
        </SettingCard>

        {([
          {
            type: 'creator' as const,
            title: "Team Creator Default Permissions",
            description: "Permissions the user will automatically be granted when creating a team",
            permissions: teamCreatorPermissions,
          }, {
            type: 'member' as const,
            title: "Team Member Default Permissions",
            description: "Permissions the user will automatically be granted when joining a team",
            permissions: teamMemberPermissions,
          }
        ]).map(({ type, title, description, permissions }) => (
          <SettingCard
            key={type}
            title={title}
            description={description}
            actions={<CreateDialog
              trigger={<Button variant="secondary">Edit</Button>}
              type={type}
            />}
          >
            <div className="flex flex-wrap gap-2">
              {permissions.length > 0 ?
                permissions.map((id) => (
                  <Badge key={id} variant='secondary'>{id}</Badge>
                )) :
                <Typography variant="secondary" type="label">No default permissions set</Typography>
              }
            </div>
          </SettingCard>
        ))}
      </PageLayout>
    </AppEnabledGuard>
  );
}
