import { TeamPermissionDefinitionsCrud } from "@stackframe/stack-shared/dist/interface/crud/team-permissions";


export type TeamPermission = {
  id: string,
};

export type AdminTeamPermission = TeamPermission;

export type AdminTeamPermissionDefinition = {
  id: string,
  description?: string,
  containedPermissionIds: string[],
  isDefaultUserPermission?: boolean,
};

export type AdminTeamPermissionDefinitionCreateOptions = {
  id: string,
  description?: string,
  containedPermissionIds: string[],
  isDefaultUserPermission?: boolean,
};
export function adminTeamPermissionDefinitionCreateOptionsToCrud(options: AdminTeamPermissionDefinitionCreateOptions): TeamPermissionDefinitionsCrud["Admin"]["Create"] {
  return {
    id: options.id,
    description: options.description,
    contained_permission_ids: options.containedPermissionIds,
    is_default_user_permission: options.isDefaultUserPermission ?? false,
  };
}

export type AdminTeamPermissionDefinitionUpdateOptions = Partial<AdminTeamPermissionDefinitionCreateOptions>;
export function adminTeamPermissionDefinitionUpdateOptionsToCrud(options: AdminTeamPermissionDefinitionUpdateOptions): TeamPermissionDefinitionsCrud["Admin"]["Update"] {
  return {
    id: options.id,
    description: options.description,
    contained_permission_ids: options.containedPermissionIds,
    is_default_user_permission: options.isDefaultUserPermission,
  };
}
