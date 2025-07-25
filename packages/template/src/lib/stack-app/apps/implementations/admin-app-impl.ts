import { StackAdminInterface } from "@stackframe/stack-shared";
import { getProductionModeErrors } from "@stackframe/stack-shared/dist/helpers/production-mode";
import { InternalApiKeyCreateCrudResponse } from "@stackframe/stack-shared/dist/interface/admin-interface";
import { EmailTemplateCrud, EmailTemplateType } from "@stackframe/stack-shared/dist/interface/crud/email-templates";
import { InternalApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/internal-api-keys";
import { ProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { useMemo } from "react"; // THIS_LINE_PLATFORM react-like
import { AdminSentEmail } from "../..";
import { EmailConfig, stackAppInternalsSymbol } from "../../common";
import { AdminEmailTemplate, AdminEmailTemplateUpdateOptions, adminEmailTemplateUpdateOptionsToCrud } from "../../email-templates";
import { InternalApiKey, InternalApiKeyBase, InternalApiKeyBaseCrudRead, InternalApiKeyCreateOptions, InternalApiKeyFirstView, internalApiKeyCreateOptionsToCrud } from "../../internal-api-keys";
import { AdminProjectPermission, AdminProjectPermissionDefinition, AdminProjectPermissionDefinitionCreateOptions, AdminProjectPermissionDefinitionUpdateOptions, AdminTeamPermission, AdminTeamPermissionDefinition, AdminTeamPermissionDefinitionCreateOptions, AdminTeamPermissionDefinitionUpdateOptions, adminProjectPermissionDefinitionCreateOptionsToCrud, adminProjectPermissionDefinitionUpdateOptionsToCrud, adminTeamPermissionDefinitionCreateOptionsToCrud, adminTeamPermissionDefinitionUpdateOptionsToCrud } from "../../permissions";
import { AdminOwnedProject, AdminProject, AdminProjectUpdateOptions, adminProjectUpdateOptionsToCrud } from "../../projects";
import { StackAdminApp, StackAdminAppConstructorOptions } from "../interfaces/admin-app";
import { clientVersion, createCache, getBaseUrl, getDefaultProjectId, getDefaultPublishableClientKey, getDefaultSecretServerKey, getDefaultSuperSecretAdminKey } from "./common";
import { _StackServerAppImplIncomplete } from "./server-app-impl";

import { ChatContent } from "@stackframe/stack-shared/dist/interface/admin-interface";
import { useAsyncCache } from "./common"; // THIS_LINE_PLATFORM react-like

export class _StackAdminAppImplIncomplete<HasTokenStore extends boolean, ProjectId extends string> extends _StackServerAppImplIncomplete<HasTokenStore, ProjectId> implements StackAdminApp<HasTokenStore, ProjectId>
{
  declare protected _interface: StackAdminInterface;

  private readonly _adminProjectCache = createCache(async () => {
    return await this._interface.getProject();
  });
  private readonly _internalApiKeysCache = createCache(async () => {
    const res = await this._interface.listInternalApiKeys();
    return res;
  });
  private readonly _adminEmailTemplatesCache = createCache(async () => {
    return await this._interface.listEmailTemplates();
  });
  private readonly _adminEmailThemeCache = createCache(async ([id]: [string]) => {
    return await this._interface.getEmailTheme(id);
  });
  private readonly _adminEmailThemesCache = createCache(async () => {
    return await this._interface.listEmailThemes();
  });
  private readonly _adminNewEmailTemplatesCache = createCache(async () => {
    return await this._interface.listInternalEmailTemplatesNew();
  });
  private readonly _adminTeamPermissionDefinitionsCache = createCache(async () => {
    return await this._interface.listTeamPermissionDefinitions();
  });
  private readonly _adminProjectPermissionDefinitionsCache = createCache(async () => {
    return await this._interface.listProjectPermissionDefinitions();
  });
  private readonly _svixTokenCache = createCache(async () => {
    return await this._interface.getSvixToken();
  });
  private readonly _metricsCache = createCache(async () => {
    return await this._interface.getMetrics();
  });
  private readonly _emailPreviewCache = createCache(async ([themeId, themeTsxSource, templateId, templateTsxSource]: [string | undefined, string | undefined, string | undefined, string | undefined]) => {
    return await this._interface.renderEmailPreview({ themeId, themeTsxSource, templateId, templateTsxSource });
  });

  constructor(options: StackAdminAppConstructorOptions<HasTokenStore, ProjectId>) {
    super({
      interface: new StackAdminInterface({
        getBaseUrl: () => getBaseUrl(options.baseUrl),
        projectId: options.projectId ?? getDefaultProjectId(),
        extraRequestHeaders: options.extraRequestHeaders ?? {},
        clientVersion,
        ..."projectOwnerSession" in options ? {
          projectOwnerSession: options.projectOwnerSession,
        } : {
          publishableClientKey: options.publishableClientKey ?? getDefaultPublishableClientKey(),
          secretServerKey: options.secretServerKey ?? getDefaultSecretServerKey(),
          superSecretAdminKey: options.superSecretAdminKey ?? getDefaultSuperSecretAdminKey(),
        },
      }),
      baseUrl: options.baseUrl,
      extraRequestHeaders: options.extraRequestHeaders,
      projectId: options.projectId,
      tokenStore: options.tokenStore,
      urls: options.urls,
      oauthScopesOnSignIn: options.oauthScopesOnSignIn,
      redirectMethod: options.redirectMethod,
    });
  }

  _adminOwnedProjectFromCrud(data: ProjectsCrud['Admin']['Read'], onRefresh: () => Promise<void>): AdminOwnedProject {
    if (this._tokenStoreInit !== null) {
      throw new StackAssertionError("Owned apps must always have tokenStore === null — did you not create this project with app._createOwnedApp()?");
    }
    return {
      ...this._adminProjectFromCrud(data, onRefresh),
      app: this as StackAdminApp<false>,
    };
  }

  _adminProjectFromCrud(data: ProjectsCrud['Admin']['Read'], onRefresh: () => Promise<void>): AdminProject {
    if (data.id !== this.projectId) {
      throw new StackAssertionError(`The project ID of the provided project JSON (${data.id}) does not match the project ID of the app (${this.projectId})!`);
    }

    const app = this;
    return {
      id: data.id,
      displayName: data.display_name,
      description: data.description,
      createdAt: new Date(data.created_at_millis),
      isProductionMode: data.is_production_mode,
      config: {
        signUpEnabled: data.config.sign_up_enabled,
        credentialEnabled: data.config.credential_enabled,
        magicLinkEnabled: data.config.magic_link_enabled,
        passkeyEnabled: data.config.passkey_enabled,
        clientTeamCreationEnabled: data.config.client_team_creation_enabled,
        clientUserDeletionEnabled: data.config.client_user_deletion_enabled,
        allowLocalhost: data.config.allow_localhost,
        oauthAccountMergeStrategy: data.config.oauth_account_merge_strategy,
        allowUserApiKeys: data.config.allow_user_api_keys,
        allowTeamApiKeys: data.config.allow_team_api_keys,
        oauthProviders: data.config.oauth_providers.map((p) => ((p.type === 'shared' ? {
          id: p.id,
          type: 'shared',
        } as const : {
          id: p.id,
          type: 'standard',
          clientId: p.client_id ?? throwErr("Client ID is missing"),
          clientSecret: p.client_secret ?? throwErr("Client secret is missing"),
          facebookConfigId: p.facebook_config_id,
          microsoftTenantId: p.microsoft_tenant_id,
        } as const))),
        emailConfig: data.config.email_config.type === 'shared' ? {
          type: 'shared'
        } : {
          type: 'standard',
          host: data.config.email_config.host ?? throwErr("Email host is missing"),
          port: data.config.email_config.port ?? throwErr("Email port is missing"),
          username: data.config.email_config.username ?? throwErr("Email username is missing"),
          password: data.config.email_config.password ?? throwErr("Email password is missing"),
          senderName: data.config.email_config.sender_name ?? throwErr("Email sender name is missing"),
          senderEmail: data.config.email_config.sender_email ?? throwErr("Email sender email is missing"),
        },
        emailTheme: data.config.email_theme,
        domains: data.config.domains.map((d) => ({
          domain: d.domain,
          handlerPath: d.handler_path,
        })),
        createTeamOnSignUp: data.config.create_team_on_sign_up,
        teamCreatorDefaultPermissions: data.config.team_creator_default_permissions,
        teamMemberDefaultPermissions: data.config.team_member_default_permissions,
        userDefaultPermissions: data.config.user_default_permissions,
      },

      async update(update: AdminProjectUpdateOptions) {
        await app._interface.updateProject(adminProjectUpdateOptionsToCrud(update));
        await onRefresh();
      },
      async delete() {
        await app._interface.deleteProject();
      },
      async getProductionModeErrors() {
        return getProductionModeErrors(data);
      },
      useProductionModeErrors() {
        return getProductionModeErrors(data);
      },
    };
  }

  _adminEmailTemplateFromCrud(data: EmailTemplateCrud['Admin']['Read']): AdminEmailTemplate {
    return {
      type: data.type,
      subject: data.subject,
      content: data.content,
      isDefault: data.is_default,
    };
  }

  override async getProject(): Promise<AdminProject> {
    return this._adminProjectFromCrud(
      Result.orThrow(await this._adminProjectCache.getOrWait([], "write-only")),
      () => this._refreshProject()
    );
  }

  // IF_PLATFORM react-like
  override useProject(): AdminProject {
    const crud = useAsyncCache(this._adminProjectCache, [], "useProjectAdmin()");
    return useMemo(() => this._adminProjectFromCrud(
      crud,
      () => this._refreshProject()
    ), [crud]);
  }
  // END_PLATFORM

  protected _createInternalApiKeyBaseFromCrud(data: InternalApiKeyBaseCrudRead): InternalApiKeyBase {
    const app = this;
    return {
      id: data.id,
      description: data.description,
      expiresAt: new Date(data.expires_at_millis),
      manuallyRevokedAt: data.manually_revoked_at_millis ? new Date(data.manually_revoked_at_millis) : null,
      createdAt: new Date(data.created_at_millis),
      isValid() {
        return this.whyInvalid() === null;
      },
      whyInvalid() {
        if (this.expiresAt.getTime() < Date.now()) return "expired";
        if (this.manuallyRevokedAt) return "manually-revoked";
        return null;
      },
      async revoke() {
        const res = await app._interface.revokeInternalApiKeyById(data.id);
        await app._refreshInternalApiKeys();
        return res;
      }
    };
  }

  protected _createInternalApiKeyFromCrud(data: InternalApiKeysCrud["Admin"]["Read"]): InternalApiKey {
    return {
      ...this._createInternalApiKeyBaseFromCrud(data),
      publishableClientKey: data.publishable_client_key ? { lastFour: data.publishable_client_key.last_four } : null,
      secretServerKey: data.secret_server_key ? { lastFour: data.secret_server_key.last_four } : null,
      superSecretAdminKey: data.super_secret_admin_key ? { lastFour: data.super_secret_admin_key.last_four } : null,
    };
  }

  protected _createInternalApiKeyFirstViewFromCrud(data: InternalApiKeyCreateCrudResponse): InternalApiKeyFirstView {
    return {
      ...this._createInternalApiKeyBaseFromCrud(data),
      publishableClientKey: data.publishable_client_key,
      secretServerKey: data.secret_server_key,
      superSecretAdminKey: data.super_secret_admin_key,
    };
  }

  async listInternalApiKeys(): Promise<InternalApiKey[]> {
    const crud = Result.orThrow(await this._internalApiKeysCache.getOrWait([], "write-only"));
    return crud.map((j) => this._createInternalApiKeyFromCrud(j));
  }

  // IF_PLATFORM react-like
  useInternalApiKeys(): InternalApiKey[] {
    const crud = useAsyncCache(this._internalApiKeysCache, [], "useInternalApiKeys()");
    return useMemo(() => {
      return crud.map((j) => this._createInternalApiKeyFromCrud(j));
    }, [crud]);
  }
  // END_PLATFORM

  async createInternalApiKey(options: InternalApiKeyCreateOptions): Promise<InternalApiKeyFirstView> {
    const crud = await this._interface.createInternalApiKey(internalApiKeyCreateOptionsToCrud(options));
    await this._refreshInternalApiKeys();
    return this._createInternalApiKeyFirstViewFromCrud(crud);
  }

  // IF_PLATFORM react-like
  useEmailTemplates(): AdminEmailTemplate[] {
    const crud = useAsyncCache(this._adminEmailTemplatesCache, [], "useEmailTemplates()");
    return useMemo(() => {
      return crud.map((j) => this._adminEmailTemplateFromCrud(j));
    }, [crud]);
  }
  // END_PLATFORM
  async listEmailTemplates(): Promise<AdminEmailTemplate[]> {
    const crud = Result.orThrow(await this._adminEmailTemplatesCache.getOrWait([], "write-only"));
    return crud.map((j) => this._adminEmailTemplateFromCrud(j));
  }

  // IF_PLATFORM react-like
  useEmailThemes(): { id: string, displayName: string }[] {
    const crud = useAsyncCache(this._adminEmailThemesCache, [], "useEmailThemes()");
    return useMemo(() => {
      return crud.map((theme) => ({
        id: theme.id,
        displayName: theme.display_name,
      }));
    }, [crud]);
  }
  useNewEmailTemplates(): { id: string, subject: string, displayName: string, tsxSource: string }[] {
    const crud = useAsyncCache(this._adminNewEmailTemplatesCache, [], "useNewEmailTemplates()");
    return useMemo(() => {
      return crud.map((template) => ({
        id: template.id,
        subject: template.subject,
        displayName: template.display_name,
        tsxSource: template.tsx_source,
      }));
    }, [crud]);
  }
  // END_PLATFORM
  async listEmailThemes(): Promise<{ id: string, displayName: string }[]> {
    const crud = Result.orThrow(await this._adminEmailThemesCache.getOrWait([], "write-only"));
    return crud.map((theme) => ({
      id: theme.id,
      displayName: theme.display_name,
    }));
  }

  async listNewEmailTemplates(): Promise<{ id: string, subject: string, displayName: string, tsxSource: string }[]> {
    const crud = Result.orThrow(await this._adminNewEmailTemplatesCache.getOrWait([], "write-only"));
    return crud.map((template) => ({
      id: template.id,
      subject: template.subject,
      displayName: template.display_name,
      tsxSource: template.tsx_source,
    }));
  }

  async updateEmailTemplate(type: EmailTemplateType, data: AdminEmailTemplateUpdateOptions): Promise<void> {
    await this._interface.updateEmailTemplate(type, adminEmailTemplateUpdateOptionsToCrud(data));
    await this._adminEmailTemplatesCache.refresh([]);
  }

  async resetEmailTemplate(type: EmailTemplateType) {
    await this._interface.resetEmailTemplate(type);
    await this._adminEmailTemplatesCache.refresh([]);
  }

  async createTeamPermissionDefinition(data: AdminTeamPermissionDefinitionCreateOptions): Promise<AdminTeamPermission>{
    const crud = await this._interface.createTeamPermissionDefinition(adminTeamPermissionDefinitionCreateOptionsToCrud(data));
    await this._adminTeamPermissionDefinitionsCache.refresh([]);
    return this._serverTeamPermissionDefinitionFromCrud(crud);
  }

  async updateTeamPermissionDefinition(permissionId: string, data: AdminTeamPermissionDefinitionUpdateOptions) {
    await this._interface.updateTeamPermissionDefinition(permissionId, adminTeamPermissionDefinitionUpdateOptionsToCrud(data));
    await this._adminTeamPermissionDefinitionsCache.refresh([]);
  }

  async deleteTeamPermissionDefinition(permissionId: string): Promise<void> {
    await this._interface.deleteTeamPermissionDefinition(permissionId);
    await this._adminTeamPermissionDefinitionsCache.refresh([]);
  }

  async listTeamPermissionDefinitions(): Promise<AdminTeamPermissionDefinition[]> {
    const crud = Result.orThrow(await this._adminTeamPermissionDefinitionsCache.getOrWait([], "write-only"));
    return crud.map((p) => this._serverTeamPermissionDefinitionFromCrud(p));
  }

  // IF_PLATFORM react-like
  useTeamPermissionDefinitions(): AdminTeamPermissionDefinition[] {
    const crud = useAsyncCache(this._adminTeamPermissionDefinitionsCache, [], "usePermissions()");
    return useMemo(() => {
      return crud.map((p) => this._serverTeamPermissionDefinitionFromCrud(p));
    }, [crud]);
  }
  // END_PLATFORM

  async createProjectPermissionDefinition(data: AdminProjectPermissionDefinitionCreateOptions): Promise<AdminProjectPermission> {
    const crud = await this._interface.createProjectPermissionDefinition(adminProjectPermissionDefinitionCreateOptionsToCrud(data));
    await this._adminProjectPermissionDefinitionsCache.refresh([]);
    return this._serverProjectPermissionDefinitionFromCrud(crud);
  }

  async updateProjectPermissionDefinition(permissionId: string, data: AdminProjectPermissionDefinitionUpdateOptions) {
    await this._interface.updateProjectPermissionDefinition(permissionId, adminProjectPermissionDefinitionUpdateOptionsToCrud(data));
    await this._adminProjectPermissionDefinitionsCache.refresh([]);
  }

  async deleteProjectPermissionDefinition(permissionId: string): Promise<void> {
    await this._interface.deleteProjectPermissionDefinition(permissionId);
    await this._adminProjectPermissionDefinitionsCache.refresh([]);
  }

  async listProjectPermissionDefinitions(): Promise<AdminProjectPermissionDefinition[]> {
    const crud = Result.orThrow(await this._adminProjectPermissionDefinitionsCache.getOrWait([], "write-only"));
    return crud.map((p) => this._serverProjectPermissionDefinitionFromCrud(p));
  }

  // IF_PLATFORM react-like
  useProjectPermissionDefinitions(): AdminProjectPermissionDefinition[] {
    const crud = useAsyncCache(this._adminProjectPermissionDefinitionsCache, [], "useProjectPermissions()");
    return useMemo(() => {
      return crud.map((p) => this._serverProjectPermissionDefinitionFromCrud(p));
    }, [crud]);
  }
  // END_PLATFORM
  // IF_PLATFORM react-like
  useSvixToken(): string {
    const crud = useAsyncCache(this._svixTokenCache, [], "useSvixToken()");
    return crud.token;
  }
  // END_PLATFORM

  protected override async _refreshProject() {
    await Promise.all([
      super._refreshProject(),
      this._adminProjectCache.refresh([]),
    ]);
  }

  protected async _refreshInternalApiKeys() {
    await this._internalApiKeysCache.refresh([]);
  }

  get [stackAppInternalsSymbol]() {
    return {
      ...super[stackAppInternalsSymbol],
      // IF_PLATFORM react-like
      useMetrics: (): any => {
        return useAsyncCache(this._metricsCache, [], "useMetrics()");
      }
      // END_PLATFORM
    };
  }

  async sendTestEmail(options: {
    recipientEmail: string,
    emailConfig: EmailConfig,
  }): Promise<Result<undefined, { errorMessage: string }>> {
    const response = await this._interface.sendTestEmail({
      recipient_email: options.recipientEmail,
      email_config: {
        ...(pick(options.emailConfig, ['host', 'port', 'username', 'password'])),
        sender_email: options.emailConfig.senderEmail,
        sender_name: options.emailConfig.senderName,
      },
    });

    if (response.success) {
      return Result.ok(undefined);
    } else {
      return Result.error({ errorMessage: response.error_message ?? throwErr("Email test error not specified") });
    }
  }

  async listSentEmails(): Promise<AdminSentEmail[]> {
    const response = await this._interface.listSentEmails();
    return response.items.map((email) => ({
      id: email.id,
      to: email.to ?? [],
      subject: email.subject,
      recipient: email.to?.[0] ?? "",
      sentAt: new Date(email.sent_at_millis),
      error: email.error,
    }));
  }

  async sendEmail(options: {
    userIds: string[],
    subject: string,
    content: string,
    notificationCategoryName: string,
  }): Promise<void> {
    await this._interface.sendEmail({
      user_ids: options.userIds,
      subject: options.subject,
      html: options.content,
      notification_category_name: options.notificationCategoryName,
    });
  }

  async sendSignInInvitationEmail(email: string, callbackUrl: string): Promise<void> {
    await this._interface.sendSignInInvitationEmail(email, callbackUrl);
  }

  async sendChatMessage(
    threadId: string,
    contextType: "email-theme" | "email-template",
    messages: Array<{ role: string, content: any }>,
    abortSignal?: AbortSignal,
  ): Promise<{ content: ChatContent }> {
    return await this._interface.sendChatMessage(threadId, contextType, messages, abortSignal);
  }

  async saveChatMessage(threadId: string, message: any): Promise<void> {
    await this._interface.saveChatMessage(threadId, message);
  }

  async listChatMessages(threadId: string): Promise<{ messages: Array<any> }> {
    return await this._interface.listChatMessages(threadId);
  }

  async createEmailTheme(displayName: string): Promise<{ id: string }> {
    const result = await this._interface.createEmailTheme(displayName);
    await this._adminEmailThemesCache.refresh([]);
    return result;
  }

  async getEmailPreview(options: { themeId?: string, themeTsxSource?: string, templateId?: string, templateTsxSource?: string }): Promise<string> {
    return (await this._interface.renderEmailPreview(options)).html;
  }
  // IF_PLATFORM react-like
  useEmailPreview(options: { themeId?: string, themeTsxSource?: string, templateId?: string, templateTsxSource?: string }): string {
    const crud = useAsyncCache(this._emailPreviewCache, [options.themeId, options.themeTsxSource, options.templateId, options.templateTsxSource] as const, "useEmailPreview()");
    return crud.html;
  }
  // END_PLATFORM
  // IF_PLATFORM react-like
  useEmailTheme(id: string): { displayName: string, tsxSource: string } {
    const crud = useAsyncCache(this._adminEmailThemeCache, [id] as const, "useEmailTheme()");
    return {
      displayName: crud.display_name,
      tsxSource: crud.tsx_source,
    };
  }
  // END_PLATFORM
  async updateEmailTheme(id: string, tsxSource: string): Promise<void> {
    await this._interface.updateEmailTheme(id, tsxSource);
  }
  async updateNewEmailTemplate(id: string, tsxSource: string): Promise<{ renderedHtml: string }> {
    const result = await this._interface.updateNewEmailTemplate(id, tsxSource);
    await this._adminNewEmailTemplatesCache.refresh([]);
    return { renderedHtml: result.rendered_html };
  }
}
