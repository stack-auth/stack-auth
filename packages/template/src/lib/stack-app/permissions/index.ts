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

export type ProjectPermission = {
  id: string,
};

export type AdminProjectPermission = ProjectPermission;

export type AdminProjectPermissionDefinition = {
  id: string,
  description?: string,
  containedPermissionIds: string[],
};

export type AdminProjectPermissionDefinitionCreateOptions = {
  id: string,
  description?: string,
  containedPermissionIds: string[],
};
export function adminProjectPermissionDefinitionCreateOptionsToCrud(options: AdminProjectPermissionDefinitionCreateOptions): ProjectPermissionDefinitionsCrud["Admin"]["Create"] {
  return {
    id: options.id,
    description: options.description,
    contained_permission_ids: options.containedPermissionIds,
  };
}

export type AdminProjectPermissionDefinitionUpdateOptions = Partial<AdminProjectPermissionDefinitionCreateOptions>;
export function adminProjectPermissionDefinitionUpdateOptionsToCrud(options: AdminProjectPermissionDefinitionUpdateOptions): ProjectPermissionDefinitionsCrud["Admin"]["Update"] {
  return {
    id: options.id,
    description: options.description,
    contained_permission_ids: options.containedPermissionIds,
  };
}
