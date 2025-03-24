"use client";
import { SmartFormDialog } from "@/components/form-dialog";
import { PermissionListField } from "@/components/permission-field";
import { Button } from "@stackframe/stack-ui";
import React from "react";
import * as yup from "yup";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { TeamPermissionTable } from "@/components/data-table/team-permission-table";

// Mock type definition until actual implementation
export type AdminUserPermissionDefinition = {
  id: string,
  description?: string,
  containedPermissionIds: string[],
};

// Mock user permissions data
const MOCK_USER_PERMISSIONS: AdminUserPermissionDefinition[] = [
  {
    id: "$read_users",
    description: "Read and list all users in the system",
    containedPermissionIds: [],
  },
  {
    id: "$update_users",
    description: "Update user information and settings",
    containedPermissionIds: ["$read_users"],
  },
  {
    id: "$delete_users",
    description: "Delete users from the system",
    containedPermissionIds: ["$read_users"],
  },
  {
    id: "$manage_user_permissions",
    description: "Manage user permissions in the system",
    containedPermissionIds: ["$read_users"],
  },
  {
    id: "user_analytics",
    description: "Access user analytics data",
    containedPermissionIds: ["$read_users"],
  },
];

// Mock useUserPermissionDefinitions hook
const useUserPermissionDefinitionsMock = () => {
  const [permissions, setPermissions] = React.useState<AdminUserPermissionDefinition[]>(MOCK_USER_PERMISSIONS);

  // Monkey patch the admin app to include our mock methods
  const stackAdminApp = useAdminApp() as any;
  if (!stackAdminApp.useUserPermissionDefinitions) {
    stackAdminApp.useUserPermissionDefinitions = () => permissions;

    stackAdminApp.createUserPermissionDefinition = async (data: { id: string, description?: string, containedPermissionIds: string[] }) => {
      setPermissions(prev => [...prev, data]);
      return await Promise.resolve();
    };

    stackAdminApp.updateUserPermissionDefinition = async (permissionId: string, data: Partial<{ id: string, description?: string, containedPermissionIds: string[] }>) => {
      setPermissions(prev =>
        prev.map(p => p.id === permissionId ? { ...p, ...data } : p)
      );
      return await Promise.resolve();
    };

    stackAdminApp.deleteUserPermissionDefinition = async (permissionId: string) => {
      setPermissions(prev => prev.filter(p => p.id !== permissionId));
      return await Promise.resolve();
    };
  }

  return permissions;
};

export default function PageClient() {
  const [createPermissionModalOpen, setCreatePermissionModalOpen] = React.useState(false);
  const permissions = useUserPermissionDefinitionsMock();

  return (
    <PageLayout
      title="User Permissions"
      actions={
        <Button onClick={() => setCreatePermissionModalOpen(true)}>
          Create Permission
        </Button>
      }>

      <TeamPermissionTable permissions={permissions}/>

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
  const permissions = MOCK_USER_PERMISSIONS;

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
      // await stackAdminApp.createUserPermissionDefinition({
      //   id: values.id,
      //   description: values.description,
      //   containedPermissionIds: values.containedPermissionIds,
      // });
    }}
    cancelButton
  />;
}
