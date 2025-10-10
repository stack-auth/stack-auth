"use client";
import { PermissionTable } from "@/components/data-table/permission-table";
import { SmartFormDialog } from "@/components/form-dialog";
import { PermissionListField } from "@/components/permission-field";
import { Button } from "@stackframe/stack-ui";
import { useTranslations } from 'next-intl';
import React from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const t = useTranslations('projectPermissions');
  const stackAdminApp = useAdminApp();
  const permissions = stackAdminApp.useProjectPermissionDefinitions();
  const [createPermissionModalOpen, setCreatePermissionModalOpen] = React.useState(false);

  return (
    <PageLayout
      title={t('title')}
      actions={
        <Button onClick={() => setCreatePermissionModalOpen(true)}>
          {t('createButton')}
        </Button>
      }>

      <PermissionTable
        permissions={permissions}
        permissionType="project"
      />

      <CreateDialog
        open={createPermissionModalOpen}
        onOpenChange={setCreatePermissionModalOpen}
      />
    </PageLayout>
  );
}

function CreateDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
}) {
  const t = useTranslations('projectPermissions');
  const stackAdminApp = useAdminApp();
  const projectPermissions = stackAdminApp.useProjectPermissionDefinitions();
  const combinedPermissions = [...stackAdminApp.useTeamPermissionDefinitions(), ...projectPermissions];

  const formSchema = yup.object({
    id: yup.string().defined()
      .notOneOf(combinedPermissions.map((p) => p.id), t('dialog.validation.idExists'))
      .matches(/^[a-z0-9_:]+$/, t('dialog.validation.idFormat'))
      .label(t('dialog.field.idLabel')),
    description: yup.string().label(t('dialog.field.descriptionLabel')),
    containedPermissionIds: yup.array().of(yup.string().defined()).defined().default([]).meta({
      stackFormFieldRender: (props) => (
        <PermissionListField {...props} permissions={projectPermissions} type="new" />
      ),
    }),
  });

  return <SmartFormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title={t('dialog.title')}
    formSchema={formSchema}
    okButton={{ label: t('dialog.createButton') }}
    onSubmit={async (values) => {
      await stackAdminApp.createProjectPermissionDefinition({
        id: values.id,
        description: values.description,
        containedPermissionIds: values.containedPermissionIds,
      });
    }}
    cancelButton
  />;
}
