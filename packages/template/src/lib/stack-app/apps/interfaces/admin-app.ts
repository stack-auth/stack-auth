import { EmailTemplateType } from "@stackframe/stack-shared/dist/interface/crud/email-templates";
import { InternalSession } from "@stackframe/stack-shared/dist/sessions";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { AsyncStoreProperty, EmailConfig } from "../../common";
import { AdminSentEmail } from "../../email";
import { AdminEmailTemplate, AdminEmailTemplateUpdateOptions } from "../../email-templates";
import { InternalApiKey, InternalApiKeyCreateOptions, InternalApiKeyFirstView } from "../../internal-api-keys";
import { AdminProjectPermission, AdminProjectPermissionDefinition, AdminProjectPermissionDefinitionCreateOptions, AdminProjectPermissionDefinitionUpdateOptions, AdminTeamPermission, AdminTeamPermissionDefinition, AdminTeamPermissionDefinitionCreateOptions, AdminTeamPermissionDefinitionUpdateOptions } from "../../permissions";
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
  & AsyncStoreProperty<"internalApiKeys", [], InternalApiKey[], true>
  & AsyncStoreProperty<"teamPermissionDefinitions", [], AdminTeamPermissionDefinition[], true>
  & AsyncStoreProperty<"projectPermissionDefinitions", [], AdminProjectPermissionDefinition[], true>
  & {
    useEmailTemplates(): AdminEmailTemplate[], // THIS_LINE_PLATFORM react-like
    listEmailTemplates(): Promise<AdminEmailTemplate[]>,
    updateEmailTemplate(type: EmailTemplateType, data: AdminEmailTemplateUpdateOptions): Promise<void>,
    resetEmailTemplate(type: EmailTemplateType): Promise<void>,

    createInternalApiKey(options: InternalApiKeyCreateOptions): Promise<InternalApiKeyFirstView>,

    createTeamPermissionDefinition(data: AdminTeamPermissionDefinitionCreateOptions): Promise<AdminTeamPermission>,
    updateTeamPermissionDefinition(permissionId: string, data: AdminTeamPermissionDefinitionUpdateOptions): Promise<void>,
    deleteTeamPermissionDefinition(permissionId: string): Promise<void>,

    createProjectPermissionDefinition(data: AdminProjectPermissionDefinitionCreateOptions): Promise<AdminProjectPermission>,
    updateProjectPermissionDefinition(permissionId: string, data: AdminProjectPermissionDefinitionUpdateOptions): Promise<void>,
    deleteProjectPermissionDefinition(permissionId: string): Promise<void>,

    useSvixToken(): string, // THIS_LINE_PLATFORM react-like

    sendTestEmail(options: {
      recipientEmail: string,
      emailConfig: EmailConfig,
    }): Promise<Result<undefined, { errorMessage: string }>>,

    sendSignInInvitationEmail(email: string, callbackUrl: string): Promise<void>,

    listSentEmails(): Promise<AdminSentEmail[]>,
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
