import { EmailTemplateType } from "@stackframe/stack-shared/dist/interface/crud/email-templates";
import { InternalSession } from "@stackframe/stack-shared/dist/sessions";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { ApiKey, ApiKeyCreateOptions, ApiKeyFirstView } from "../../api-keys";
import { AsyncStoreProperty, EmailConfig } from "../../common";
import { AdminEmailTemplate, AdminEmailTemplateUpdateOptions } from "../../email-templates";
import { AdminTeamPermission, AdminTeamPermissionDefinition, AdminTeamPermissionDefinitionCreateOptions, AdminTeamPermissionDefinitionUpdateOptions } from "../../permissions";
import { AdminProject } from "../../projects";
import { _StackAdminAppImpl } from "../implementations";
import { StackServerApp, StackServerAppConstructorOptions } from "./server-app";


export type StackAdminAppConstructorOptions<HasTokenStore extends boolean, ProjectId extends string> = (
  | (
    & StackServerAppConstructorOptions<HasTokenStore, ProjectId>
    & {
      superSecretAdminKey?: string,
    }
  )
  | (
    & Omit<StackServerAppConstructorOptions<HasTokenStore, ProjectId>, "publishableClientKey" | "secretServerKey">
    & {
      projectOwnerSession: InternalSession,
    }
  )
);


export type StackAdminApp<HasTokenStore extends boolean = boolean, ProjectId extends string = string> = (
  & AsyncStoreProperty<"project", [], AdminProject, false>
  & AsyncStoreProperty<"apiKeys", [], ApiKey[], true>
  & AsyncStoreProperty<"teamPermissionDefinitions", [], AdminTeamPermissionDefinition[], true>
  & {
    // NEXT_LINE_PLATFORM react-like
    useEmailTemplates(): AdminEmailTemplate[],
    listEmailTemplates(): Promise<AdminEmailTemplate[]>,
    updateEmailTemplate(type: EmailTemplateType, data: AdminEmailTemplateUpdateOptions): Promise<void>,
    resetEmailTemplate(type: EmailTemplateType): Promise<void>,

    createApiKey(options: ApiKeyCreateOptions): Promise<ApiKeyFirstView>,

    createTeamPermissionDefinition(data: AdminTeamPermissionDefinitionCreateOptions): Promise<AdminTeamPermission>,
    updateTeamPermissionDefinition(permissionId: string, data: AdminTeamPermissionDefinitionUpdateOptions): Promise<void>,
    deleteTeamPermissionDefinition(permissionId: string): Promise<void>,

    // NEXT_LINE_PLATFORM react-like
    useSvixToken(): string,

    sendTestEmail(options: {
      recipientEmail: string,
      emailConfig: EmailConfig,
    }): Promise<Result<undefined, { errorMessage: string }>>,
  }
  & StackServerApp<HasTokenStore, ProjectId>
);
export type StackAdminAppConstructor = {
  new <
    HasTokenStore extends boolean,
    ProjectId extends string
  >(options: StackAdminAppConstructorOptions<HasTokenStore, ProjectId>): StackAdminApp<HasTokenStore, ProjectId>,
  new (options: StackAdminAppConstructorOptions<boolean, string>): StackAdminApp<boolean, string>,
};
export const StackAdminApp: StackAdminAppConstructor = _StackAdminAppImpl;
