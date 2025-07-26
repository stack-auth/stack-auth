import { OrganizationRenderedConfig } from "@stackframe/stack-shared/dist/config/schema";
import { ProductionModeError } from "@stackframe/stack-shared/dist/helpers/production-mode";
import { AdminUserProjectsCrud, ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { StackAdminApp } from "../apps/interfaces/admin-app";
import { ProjectConfig } from "../project-configs";


export type Project = {
  readonly id: string,
  readonly displayName: string,
  readonly config: ProjectConfig,
};

export type AdminProject = {
  readonly id: string,
  readonly displayName: string,
  readonly description: string | null,
  readonly createdAt: Date,
  readonly isProductionMode: boolean,

  update(this: AdminProject, update: AdminProjectUpdateOptions): Promise<void>,
  delete(this: AdminProject): Promise<void>,

  getConfig(this: AdminProject): Promise<OrganizationRenderedConfig>,
  useConfig(this: AdminProject): OrganizationRenderedConfig,

  getProductionModeErrors(this: AdminProject): Promise<ProductionModeError[]>,
  useProductionModeErrors(this: AdminProject): ProductionModeError[],
} & Project;

export type AdminOwnedProject = {
  readonly app: StackAdminApp<false>,
} & AdminProject;

export type AdminProjectUpdateOptions = {
  displayName?: string,
  description?: string,
  isProductionMode?: boolean,
};
export function adminProjectUpdateOptionsToCrud(options: AdminProjectUpdateOptions): ProjectsCrud["Admin"]["Update"] {
  return {
    display_name: options.displayName,
    description: options.description,
    is_production_mode: options.isProductionMode,
  };
}

export type AdminProjectCreateOptions = Omit<AdminProjectUpdateOptions, 'displayName'> & {
  displayName: string,
};
export function adminProjectCreateOptionsToCrud(options: AdminProjectCreateOptions): AdminUserProjectsCrud["Server"]["Create"] {
  return {
    ...adminProjectUpdateOptionsToCrud(options),
    display_name: options.displayName,
  };
}
