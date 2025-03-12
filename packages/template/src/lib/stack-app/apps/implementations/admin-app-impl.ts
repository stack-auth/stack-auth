import { StackAdminInterface } from "@stackframe/stack-shared";
import { getProductionModeErrors } from "@stackframe/stack-shared/dist/helpers/production-mode";
import { ApiKeyCreateCrudResponse } from "@stackframe/stack-shared/dist/interface/adminInterface";
import { ApiKeysCrud } from "@stackframe/stack-shared/dist/interface/crud/api-keys";
import { EmailTemplateCrud, EmailTemplateType } from "@stackframe/stack-shared/dist/interface/crud/email-templates";
import { InternalProjectsCrud } from "@stackframe/stack-shared/dist/interface/crud/projects";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { pick } from "@stackframe/stack-shared/dist/utils/objects";
import { Result } from "@stackframe/stack-shared/dist/utils/results";

import { InternalEmailsCrud } from "@stackframe/stack-shared/dist/interface/crud/emails";
import { ApiKey, ApiKeyBase, ApiKeyBaseCrudRead, ApiKeyCreateOptions, ApiKeyFirstView, apiKeyCreateOptionsToCrud } from "../../api-keys";
import { EmailConfig, stackAppInternalsSymbol } from "../../common";
import { AdminEmailTemplate, AdminEmailTemplateUpdateOptions, adminEmailTemplateUpdateOptionsToCrud } from "../../email-templates";
import { AdminTeamPermission, AdminTeamPermissionDefinition, AdminTeamPermissionDefinitionCreateOptions, AdminTeamPermissionDefinitionUpdateOptions, adminTeamPermissionDefinitionCreateOptionsToCrud, adminTeamPermissionDefinitionUpdateOptionsToCrud } from "../../permissions";
import { AdminOwnedProject, AdminProject, AdminProjectUpdateOptions, adminProjectUpdateOptionsToCrud } from "../../projects";
import { StackAdminApp, StackAdminAppConstructorOptions } from "../interfaces/admin-app";
import { clientVersion, createCache, getBaseUrl, getDefaultProjectId, getDefaultPublishableClientKey, getDefaultSecretServerKey, getDefaultSuperSecretAdminKey } from "./common";
import { _StackServerAppImplIncomplete } from "./server-app-impl";

// NEXT_LINE_PLATFORM react-like
import { useMemo } from "react";
// NEXT_LINE_PLATFORM react-like
import { useAsyncCache } from "./common";
import { AdminSentEmail } from "../../email";


export class _StackAdminAppImplIncomplete<HasTokenStore extends boolean, ProjectId extends string> extends _StackServerAppImplIncomplete<HasTokenStore, ProjectId>
{
  declare protected _interface: StackAdminInterface;

  private readonly _adminProjectCache = createCache(async () => {
    return await this._interface.getProject();
  });
  private readonly _apiKeysCache = createCache(async () => {
    return await this._interface.listApiKeys();
  });
  private readonly _adminEmailTemplatesCache = createCache(async () => {
    return await this._interface.listEmailTemplates();
  });
  private readonly _adminTeamPermissionDefinitionsCache = createCache(async () => {
    return await this._interface.listPermissionDefinitions();
  });
  private readonly _svixTokenCache = createCache(async () => {
    return await this._interface.getSvixToken();
  });
  private readonly _metricsCache = createCache(async () => {
    return await this._interface.getMetrics();
  });

  constructor(options: StackAdminAppConstructorOptions<HasTokenStore, ProjectId>) {
    super({
      interface: new StackAdminInterface({
        getBaseUrl: () => getBaseUrl(options.baseUrl),
        projectId: options.projectId ?? getDefaultProjectId(),
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
      projectId: options.projectId,
      tokenStore: options.tokenStore,
      urls: options.urls,
      oauthScopesOnSignIn: options.oauthScopesOnSignIn,
      redirectMethod: options.redirectMethod,
    });
  }

  _adminOwnedProjectFromCrud(data: InternalProjectsCrud['Admin']['Read'], onRefresh: () => Promise<void>): AdminOwnedProject {
    if (this._tokenStoreInit !== null) {
      throw new StackAssertionError("Owned apps must always have tokenStore === null — did you not create this project with app._createOwnedApp()?");;
    }
    return {
      ...this._adminProjectFromCrud(data, onRefresh),
      app: this as StackAdminApp<false>,
    };
  }

  _adminProjectFromCrud(data: InternalProjectsCrud['Admin']['Read'], onRefresh: () => Promise<void>): AdminProject {
    if (data.id !== this.projectId) {
      throw new StackAssertionError(`The project ID of the provided project JSON (${data.id}) does not match the project ID of the app (${this.projectId})!`);
    }

    const app = this;
    return {
      id: data.id,
      displayName: data.display_name,
      description: data.description,
      createdAt: new Date(data.created_at_millis),
      userCount: data.user_count,
      isProductionMode: data.is_production_mode,
      config: {
        id: data.config.id,
        signUpEnabled: data.config.sign_up_enabled,
        credentialEnabled: data.config.credential_enabled,
        magicLinkEnabled: data.config.magic_link_enabled,
        passkeyEnabled: data.config.passkey_enabled,
        clientTeamCreationEnabled: data.config.client_team_creation_enabled,
        clientUserDeletionEnabled: data.config.client_user_deletion_enabled,
        allowLocalhost: data.config.allow_localhost,
        oauthAccountMergeStrategy: data.config.oauth_account_merge_strategy,
        oauthProviders: data.config.oauth_providers.map((p) => ((p.type === 'shared' ? {
          id: p.id,
          enabled: p.enabled,
          type: 'shared',
        } as const : {
          id: p.id,
          enabled: p.enabled,
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
        domains: data.config.domains.map((d) => ({
          domain: d.domain,
          handlerPath: d.handler_path,
        })),
        createTeamOnSignUp: data.config.create_team_on_sign_up,
        teamCreatorDefaultPermissions: data.config.team_creator_default_permissions,
        teamMemberDefaultPermissions: data.config.team_member_default_permissions,
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

  protected _createApiKeyBaseFromCrud(data: ApiKeyBaseCrudRead): ApiKeyBase {
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
        const res = await app._interface.revokeApiKeyById(data.id);
        await app._refreshApiKeys();
        return res;
      }
    };
  }

  protected _createApiKeyFromCrud(data: ApiKeysCrud["Admin"]["Read"]): ApiKey {
    return {
      ...this._createApiKeyBaseFromCrud(data),
      publishableClientKey: data.publishable_client_key ? { lastFour: data.publishable_client_key.last_four } : null,
      secretServerKey: data.secret_server_key ? { lastFour: data.secret_server_key.last_four } : null,
      superSecretAdminKey: data.super_secret_admin_key ? { lastFour: data.super_secret_admin_key.last_four } : null,
    };
  }

  protected _createApiKeyFirstViewFromCrud(data: ApiKeyCreateCrudResponse): ApiKeyFirstView {
    return {
      ...this._createApiKeyBaseFromCrud(data),
      publishableClientKey: data.publishable_client_key,
      secretServerKey: data.secret_server_key,
      superSecretAdminKey: data.super_secret_admin_key,
    };
  }

  async listApiKeys(): Promise<ApiKey[]> {
    const crud = Result.orThrow(await this._apiKeysCache.getOrWait([], "write-only"));
    return crud.map((j) => this._createApiKeyFromCrud(j));
  }

  // IF_PLATFORM react-like
  useApiKeys(): ApiKey[] {
    const crud = useAsyncCache(this._apiKeysCache, [], "useApiKeys()");
    return useMemo(() => {
      return crud.map((j) => this._createApiKeyFromCrud(j));
    }, [crud]);
  }
  // END_PLATFORM

  async createApiKey(options: ApiKeyCreateOptions): Promise<ApiKeyFirstView> {
    const crud = await this._interface.createApiKey(apiKeyCreateOptionsToCrud(options));
    await this._refreshApiKeys();
    return this._createApiKeyFirstViewFromCrud(crud);
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

  async updateEmailTemplate(type: EmailTemplateType, data: AdminEmailTemplateUpdateOptions): Promise<void> {
    await this._interface.updateEmailTemplate(type, adminEmailTemplateUpdateOptionsToCrud(data));
    await this._adminEmailTemplatesCache.refresh([]);
  }

  async resetEmailTemplate(type: EmailTemplateType) {
    await this._interface.resetEmailTemplate(type);
    await this._adminEmailTemplatesCache.refresh([]);
  }

  async createTeamPermissionDefinition(data: AdminTeamPermissionDefinitionCreateOptions): Promise<AdminTeamPermission>{
    const crud = await this._interface.createPermissionDefinition(adminTeamPermissionDefinitionCreateOptionsToCrud(data));
    await this._adminTeamPermissionDefinitionsCache.refresh([]);
    return this._serverTeamPermissionDefinitionFromCrud(crud);
  }

  async updateTeamPermissionDefinition(permissionId: string, data: AdminTeamPermissionDefinitionUpdateOptions) {
    await this._interface.updatePermissionDefinition(permissionId, adminTeamPermissionDefinitionUpdateOptionsToCrud(data));
    await this._adminTeamPermissionDefinitionsCache.refresh([]);
  }

  async deleteTeamPermissionDefinition(permissionId: string): Promise<void> {
    await this._interface.deletePermissionDefinition(permissionId);
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

  protected async _refreshApiKeys() {
    await this._apiKeysCache.refresh([]);
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
}
