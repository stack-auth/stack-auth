"use client";
import { SmartFormDialog } from "@/components/form-dialog";
import { PermissionListField } from "@/components/permission-field";
import { SettingCard, SettingSwitch } from "@/components/settings";
import { Badge, Button, Typography } from "@stackframe/stack-ui";
import { useTranslations } from 'next-intl';
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

function CreateDialog(props: {
  trigger: React.ReactNode,
  type: "creator" | "member",
}) {
  const t = useTranslations('teamSettings');
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();
  const permissions = stackAdminApp.useTeamPermissionDefinitions();
  const selectedPermissionIds = props.type === "creator" ?
    project.config.teamCreatorDefaultPermissions.map(x => x.id) :
    project.config.teamMemberDefaultPermissions.map(x => x.id);

  const formSchema = yup.object({
    permissions: yup.array().of(yup.string().defined()).defined().meta({
      stackFormFieldRender: (props) => (
        <PermissionListField
          {...props}
          permissions={permissions}
          selectedPermissionIds={selectedPermissionIds}
          type="select"
          label={t('dialog.permissionsLabel')}
        />
      ),
    }).default(selectedPermissionIds),
  });

  return <SmartFormDialog
    trigger={props.trigger}
    title={t(`dialog.title.${props.type}`)}
    formSchema={formSchema}
    okButton={{ label: t('dialog.saveButton') }}
    onSubmit={async (values) => {
      if (props.type === "creator") {
        await project.update({
          config: {
            teamCreatorDefaultPermissions: values.permissions.map((id) => ({ id })),
          },
        });
      } else {
        await project.update({
          config: {
            teamMemberDefaultPermissions: values.permissions.map((id) => ({ id })),
          },
        });
      }
    }}
    cancelButton
  />;
}

export default function PageClient() {
  const t = useTranslations('teamSettings');
  const stackAdminApp = useAdminApp();
  const project = stackAdminApp.useProject();

  return (
    <PageLayout title={t('title')}>
      <SettingCard title={t('clientCreation.title')}>
        <SettingSwitch
          label={t('clientCreation.label')}
          checked={project.config.clientTeamCreationEnabled}
          onCheckedChange={async (checked) => {
            await project.update({
              config: {
                clientTeamCreationEnabled: checked,
              },
            });
          }}
        />
        <Typography variant="secondary" type="footnote">
          {t('clientCreation.hint')}
        </Typography>
      </SettingCard>

      <SettingCard title={t('autoCreation.title')}>
        <SettingSwitch
          label={t('autoCreation.label')}
          checked={project.config.createTeamOnSignUp}
          onCheckedChange={async (checked) => {
            await project.update({
              config: {
                createTeamOnSignUp: checked,
              },
            });
          }}
        />
        <Typography variant="secondary" type="footnote">
          {t('autoCreation.hint')}
        </Typography>
      </SettingCard>

      {([
        {
          type: 'creator',
          title: t('permissions.creator.title'),
          description: t('permissions.creator.description'),
          key: 'teamCreatorDefaultPermissions',
        }, {
          type: 'member',
          title: t('permissions.member.title'),
          description: t('permissions.member.description'),
          key: 'teamMemberDefaultPermissions',
        }
      ] as const).map(({ type, title, description, key }) => (
        <SettingCard
          key={key}
          title={title}
          description={description}
          actions={<CreateDialog
            trigger={<Button variant="secondary">{t('permissions.editButton')}</Button>}
            type={type}
          />}
        >
          <div className="flex flex-wrap gap-2">
            {project.config[key].length > 0 ?
              project.config[key].map((p) => (
                <Badge key={p.id} variant='secondary'>{p.id}</Badge>
              )) :
              <Typography variant="secondary" type="label">{t('permissions.noPermissions')}</Typography>
            }
          </div>
        </SettingCard>
      ))}
    </PageLayout>
  );
}
