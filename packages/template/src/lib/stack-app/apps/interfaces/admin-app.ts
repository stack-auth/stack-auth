import { ChatContent } from "@stackframe/stack-shared/dist/interface/admin-interface";
import type { AdminTransaction } from "@stackframe/stack-shared/dist/interface/crud/transactions";
import { InternalSession } from "@stackframe/stack-shared/dist/sessions";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { AsyncStoreProperty, EmailConfig } from "../../common";
import { AdminSentEmail } from "../../email";
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
  & AsyncStoreProperty<"emailThemes", [], { id: string, displayName: string }[], true>
  & AsyncStoreProperty<"emailPreview", [{ themeId?: string | null | false, themeTsxSource?: string, templateId?: string, templateTsxSource?: string }], string, false>
  & AsyncStoreProperty<"emailTemplates", [], { id: string, displayName: string, themeId?: string, tsxSource: string }[], true>
  & AsyncStoreProperty<"emailDrafts", [], { id: string, displayName: string, themeId: string | undefined | false, tsxSource: string, sentAt: Date | null }[], true>
  & AsyncStoreProperty<"stripeAccountInfo", [], { account_id: string, charges_enabled: boolean, details_submitted: boolean, payouts_enabled: boolean } | null, false>
  & AsyncStoreProperty<
    "transactions",
    [
      { cursor?: string, limit?: number, type?: 'subscription' | 'one_time' | 'item_quantity_change', customerType?: 'user' | 'team' | 'custom' }
    ],
    { transactions: AdminTransaction[], nextCursor: string | null },
    true
  >
  & {
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

    useEmailTheme(id: string): { displayName: string, tsxSource: string }, // THIS_LINE_PLATFORM react-like
    createEmailTheme(displayName: string): Promise<{ id: string }>,
    updateEmailTheme(id: string, tsxSource: string): Promise<void>,

    sendChatMessage(
      threadId: string,
      contextType: "email-theme" | "email-template" | "email-draft",
      messages: Array<{ role: string, content: any }>,
      abortSignal?: AbortSignal,
    ): Promise<{ content: ChatContent }>,
    saveChatMessage(threadId: string, message: any): Promise<void>,
    listChatMessages(threadId: string): Promise<{ messages: Array<any> }>,
    updateEmailTemplate(id: string, tsxSource: string, themeId: string | null | false): Promise<{ renderedHtml: string }>,
    createEmailTemplate(displayName: string): Promise<{ id: string }>,

    setupPayments(): Promise<{ url: string }>,
    createStripeWidgetAccountSession(): Promise<{ client_secret: string }>,
    createEmailDraft(options: { displayName: string, themeId?: string | undefined | false, tsxSource?: string }): Promise<{ id: string }>,
    updateEmailDraft(id: string, data: { displayName?: string, themeId?: string | undefined | false, tsxSource?: string }): Promise<void>,
    createItemQuantityChange(options: (
      { userId: string, itemId: string, quantity: number, expiresAt?: string, description?: string } |
      { teamId: string, itemId: string, quantity: number, expiresAt?: string, description?: string } |
      { customCustomerId: string, itemId: string, quantity: number, expiresAt?: string, description?: string }
    )): Promise<void>,
    testModePurchase(options: { priceId: string, fullCode: string, quantity?: number }): Promise<void>,
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
