import { TeamPermissionDefinitionsCrud } from "@stackframe/stack-shared/dist/interface/crud/team-permissions";
import { ProjectPermissionDefinitionsCrud } from "@stackframe/stack-shared/dist/interface/crud/project-permissions";


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
  };
}

export type AdminTeamPermissionDefinitionUpdateOptions = Partial<AdminTeamPermissionDefinitionCreateOptions>;
export function adminTeamPermissionDefinitionUpdateOptionsToCrud(options: AdminTeamPermissionDefinitionUpdateOptions): TeamPermissionDefinitionsCrud["Admin"]["Update"] {
  return {
    id: options.id,
    description: options.description,
    contained_permission_ids: options.containedPermissionIds,
  };
}

export type UserPermission = {
  id: string,
};

export type AdminUserPermission = UserPermission;

export type AdminUserPermissionDefinition = {
  id: string,
  description?: string,
  containedPermissionIds: string[],
};

export type AdminUserPermissionDefinitionCreateOptions = {
  id: string,
  description?: string,
  containedPermissionIds: string[],
};
export function adminUserPermissionDefinitionCreateOptionsToCrud(options: AdminUserPermissionDefinitionCreateOptions): ProjectPermissionDefinitionsCrud["Admin"]["Create"] {
  return {
    id: options.id,
    description: options.description,
    contained_permission_ids: options.containedPermissionIds,
  };
}

export type AdminUserPermissionDefinitionUpdateOptions = Partial<AdminUserPermissionDefinitionCreateOptions>;
export function adminUserPermissionDefinitionUpdateOptionsToCrud(options: AdminUserPermissionDefinitionUpdateOptions): ProjectPermissionDefinitionsCrud["Admin"]["Update"] {
  return {
    id: options.id,
    description: options.description,
    contained_permission_ids: options.containedPermissionIds,
  };
}
