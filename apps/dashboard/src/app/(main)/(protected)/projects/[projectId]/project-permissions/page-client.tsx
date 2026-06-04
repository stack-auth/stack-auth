"use client";
import { PermissionTable } from "@/components/data-table/permission-table";
import { SmartFormDialog } from "@/components/form-dialog";
import { PermissionListField } from "@/components/permission-field";
import { DesignButton } from "@/components/design-components";
import React from "react";
import * as yup from "yup";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";

/**
 * @dashboardReference rbac/project-permissions
 * @dashboardReferenceDescription Define project-scoped permission IDs and compose them into roles.
 *
 * ## Header
 *
 * **Create Permission** opens a dialog with **ID** (lowercase, numbers, `_`, `:`), **Description**, and **Contained permissions** (inherit other project permissions).
 *
 * ## Permissions table (`DataGrid`)
 *
 * Paginated, searchable list of project permission definitions. Row actions:
 *
 * - **Edit** — update description and contained permissions (ID is read-only)
 * - **Delete** — remove the permission definition
 *
 * Permission IDs map directly to `$permission_id` checks in the SDK (`user.hasPermission`, etc.).
 *
 * Public guide: [RBAC](https://docs.hexclave.com/docs/apps/rbac).
 */

export default function PageClient() {
  const [createPermissionModalOpen, setCreatePermissionModalOpen] = React.useState(false);
  const [tableVersion, setTableVersion] = React.useState(0);

  return (
    <AppEnabledGuard appId="rbac">
      <PageLayout
        title="Project Permissions"
        actions={
          <DesignButton onClick={() => setCreatePermissionModalOpen(true)}>
            Create Permission
          </DesignButton>
        }
      >
        <PermissionTable
          permissionType="project"
          version={tableVersion}
        />

        <CreateDialog
          open={createPermissionModalOpen}
          onOpenChange={setCreatePermissionModalOpen}
          onCreated={() => setTableVersion((v) => v + 1)}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}

function CreateDialog(props: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  onCreated?: () => void,
}) {
  const stackAdminApp = useAdminApp();
  const projectPermissions = stackAdminApp.useProjectPermissionDefinitions();
  const combinedPermissions = [...stackAdminApp.useTeamPermissionDefinitions(), ...projectPermissions];

  const formSchema = yup.object({
    id: yup.string().defined()
      .notOneOf(combinedPermissions.map((p) => p.id), "ID already exists")
      .matches(/^[a-z0-9_:]+$/, 'Only lowercase letters, numbers, ":" and "_" are allowed')
      .label("ID"),
    description: yup.string().label("Description"),
    containedPermissionIds: yup.array().of(yup.string().defined()).defined().default([]).meta({
      stackFormFieldRender: (props) => (
        <PermissionListField {...props} permissions={projectPermissions} type="new" />
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
      await stackAdminApp.createProjectPermissionDefinition({
        id: values.id,
        description: values.description,
        containedPermissionIds: values.containedPermissionIds,
      });
      props.onCreated?.();
    }}
    cancelButton
  />;
}
