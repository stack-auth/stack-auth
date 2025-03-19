import { BranchNormalizedConfig, EnvironmentNormalizedConfig, OrganizationConfig, ProjectNormalizedConfig } from "./schema";

export function getNormalizedProjectConfig(options: {
  projectId: string,
}): ProjectNormalizedConfig {
  throw new Error('Not implemented');
}

export function getNormalizedBranchConfig(options: {
  projectId: string,
  branchId: string,
}): BranchNormalizedConfig {
  throw new Error('Not implemented');
}

export function getNormalizedEnvironmentConfig(options: {
  projectId: string,
  branchId: string,
}): EnvironmentNormalizedConfig {
  throw new Error('Not implemented');
}

export function getNormalizedOrganizationConfig(options: {
  projectId: string,
  branchId: string,
  organizationId: string,
}): OrganizationConfig {
  throw new Error('Not implemented');
}

export function validateProjectConfigOverride(configOverride: any): void {
  throw new Error('Not implemented');
}

export function validateBranchConfigOverride(configOverride: any): void {
  throw new Error('Not implemented');
}

export function validateEnvironmentConfigOverride(configOverride: any): void {
  throw new Error('Not implemented');
}

export function validateOrganizationConfigOverride(configOverride: any): void {
  throw new Error('Not implemented');
}

export function applyProjectConfigToOrganizationConfig(): OrganizationConfig {
  throw new Error('Not implemented');
}

export function applyBranchConfigToOrganizationConfig(): OrganizationConfig {
  throw new Error('Not implemented');
}

export function applyEnvironmentConfigToBranchConfig(): BranchNormalizedConfig {
  throw new Error('Not implemented');
}

export function applyEnvironmentConfigToOrganizationConfig(): OrganizationConfig {
  throw new Error('Not implemented');
}
