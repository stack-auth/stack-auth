"use client";
import { PermissionTable } from "@/components/data-table/permission-table";
import { SmartFormDialog } from "@/components/form-dialog";
import { PermissionListField } from "@/components/permission-field";
import { Button } from "@stackframe/stack-ui";
import React from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

export default function PageClient() {
  const stackAdminApp = useAdminApp();
  const permissions = stackAdminApp.useUserPermissionDefinitions();
  const [createPermissionModalOpen, setCreatePermissionModalOpen] = React.useState(false);

  return (
    <PageLayout
      title="User Permissions"
      actions={
        <Button onClick={() => setCreatePermissionModalOpen(true)}>
          Create Permission
        </Button>
      }>

      <PermissionTable
        permissions={permissions}
        permissionType="user"
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
  const stackAdminApp = useAdminApp();
  const permissions = stackAdminApp.useUserPermissionDefinitions();

  const formSchema = yup.object({
    id: yup.string().defined()
      .notOneOf(permissions.map((p) => p.id), "ID already exists")
      .matches(/^[a-z0-9_:]+$/, 'Only lowercase letters, numbers, ":" and "_" are allowed')
      .label("ID"),
    description: yup.string().label("Description"),
    containedPermissionIds: yup.array().of(yup.string().defined()).defined().default([]).meta({
      stackFormFieldRender: (props) => (
        <PermissionListField {...props} permissions={permissions} type="new" />
      ),
    }),
  });

  return <SmartFormDialog
    open={props.open}
    onOpenChange={props.onOpenChange}
    title="Create Permission"
    formSchema={formSchema}
    okButton={{ label: "Create" }}
    onSubmit={async (values) => {
      await stackAdminApp.createUserPermissionDefinition({
        id: values.id,
        description: values.description,
        containedPermissionIds: values.containedPermissionIds,
      });
    }}
    cancelButton
  />;
}
