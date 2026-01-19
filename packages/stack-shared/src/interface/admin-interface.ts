import { KnownErrors } from "../known-errors";
import { AccessToken, InternalSession, RefreshToken } from "../sessions";
import { Result } from "../utils/results";
import { EmailOutboxCrud } from "./crud/email-outbox";
import { InternalEmailsCrud } from "./crud/emails";
import { InternalApiKeysCrud } from "./crud/internal-api-keys";
import { ProjectPermissionDefinitionsCrud } from "./crud/project-permissions";
import { ProjectsCrud } from "./crud/projects";
import { SvixTokenCrud } from "./crud/svix-token";
import { TeamPermissionDefinitionsCrud } from "./crud/team-permissions";
import type { Transaction, TransactionType } from "./crud/transactions";
import { ServerAuthApplicationOptions, StackServerInterface } from "./server-interface";
import type { MoneyAmount } from "../utils/currency-constants";


export type ChatContent = Array<
  | { type: "text", text: string }
  | { type: "tool-call", toolName: string, toolCallId: string, args: any, argsText: string, result: any }
>;

export type AdminAuthApplicationOptions = ServerAuthApplicationOptions &(
  | {
    superSecretAdminKey: string,
  }
  | {
    projectOwnerSession: InternalSession,
  }
);

export type InternalApiKeyCreateCrudRequest = {
  has_publishable_client_key: boolean,
  has_secret_server_key: boolean,
  has_super_secret_admin_key: boolean,
  expires_at_millis: number,
  description: string,
};

export type InternalApiKeyCreateCrudResponse = InternalApiKeysCrud["Admin"]["Read"] & {
  publishable_client_key?: string,
  secret_server_key?: string,
  super_secret_admin_key?: string,
};

export class StackAdminInterface extends StackServerInterface {
  constructor(public readonly options: AdminAuthApplicationOptions) {
    super(options);
  }

  public async sendAdminRequest(path: string, options: RequestInit, session: InternalSession | null, requestType: "admin" = "admin") {
    return await this.sendServerRequest(
      path,
      {
        ...options,
        headers: {
          "x-stack-super-secret-admin-key": "superSecretAdminKey" in this.options ? this.options.superSecretAdminKey : "",
          ...options.headers,
        },
      },
      session,
      requestType,
    );
  }

  protected async sendAdminRequestAndCatchKnownError<E extends typeof KnownErrors[keyof KnownErrors]>(
    path: string,
    requestOptions: RequestInit,
    tokenStoreOrNull: InternalSession | null,
    errorsToCatch: readonly E[],
  ): Promise<Result<
    Response & {
      usedTokens: {
        accessToken: AccessToken,
        refreshToken: RefreshToken | null,
      } | null,
    },
    InstanceType<E>
  >> {
    try {
      return Result.ok(await this.sendAdminRequest(path, requestOptions, tokenStoreOrNull));
    } catch (e) {
      for (const errorType of errorsToCatch) {
        if (errorType.isInstance(e)) {
          return Result.error(e as InstanceType<E>);
        }
      }
      throw e;
    }
  }

  async getProject(): Promise<ProjectsCrud["Admin"]["Read"]> {
    const response = await this.sendAdminRequest(
      "/internal/projects/current",
      {
        method: "GET",
      },
      null,
    );
    return await response.json();
  }

  async updateProject(update: ProjectsCrud["Admin"]["Update"]): Promise<ProjectsCrud["Admin"]["Read"]> {
    const response = await this.sendAdminRequest(
      "/internal/projects/current",
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(update),
      },
      null,
    );
    return await response.json();
  }

  async createInternalApiKey(
    options: InternalApiKeyCreateCrudRequest,
  ): Promise<InternalApiKeyCreateCrudResponse> {
    const response = await this.sendAdminRequest(
      "/internal/api-keys",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(options),
      },
      null,
    );
    return await response.json();
  }

  async listInternalApiKeys(): Promise<InternalApiKeysCrud["Admin"]["Read"][]> {
    const response = await this.sendAdminRequest("/internal/api-keys", {}, null);
    const result = await response.json() as InternalApiKeysCrud["Admin"]["List"];
    return result.items;
  }

  async revokeInternalApiKeyById(id: string) {
    await this.sendAdminRequest(
      `/internal/api-keys/${id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          revoked: true,
        }),
      },
      null,
    );
  }

  async getInternalApiKey(id: string, session: InternalSession): Promise<InternalApiKeysCrud["Admin"]["Read"]> {
    const response = await this.sendAdminRequest(`/internal/api-keys/${id}`, {}, session);
    return await response.json();
  }

  async listInternalEmailTemplates(): Promise<{ id: string, display_name: string, theme_id?: string, tsx_source: string }[]> {
    const response = await this.sendAdminRequest(`/internal/email-templates`, {}, null);
    const result = await response.json() as { templates: { id: string, display_name: string, theme_id?: string, tsx_source: string }[] };
    return result.templates;
  }

  async listInternalEmailDrafts(): Promise<{ id: string, display_name: string, theme_id?: string | undefined | false, tsx_source: string, sent_at_millis?: number | null }[]> {
    const response = await this.sendAdminRequest(`/internal/email-drafts`, {}, null);
    const result = await response.json() as { drafts: { id: string, display_name: string, theme_id?: string | undefined | false, tsx_source: string, sent_at_millis?: number | null }[] };
    return result.drafts;
  }

  async createEmailDraft(options: { display_name?: string, theme_id?: string | false, tsx_source?: string }): Promise<{ id: string }> {
    const response = await this.sendAdminRequest(
      `/internal/email-drafts`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(options),
      },
      null,
    );
    return await response.json();
  }

  async updateEmailDraft(id: string, data: { display_name?: string, theme_id?: string | null | false, tsx_source?: string, sent_at_millis?: number | null }): Promise<void> {
    await this.sendAdminRequest(
      `/internal/email-drafts/${id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
  }

  async listEmailThemes(): Promise<{ id: string, display_name: string }[]> {
    const response = await this.sendAdminRequest(`/internal/email-themes`, {}, null);
    const result = await response.json() as { themes: { id: string, display_name: string }[] };
    return result.themes;
  }


  // Team permission definitions methods
  async listTeamPermissionDefinitions(): Promise<TeamPermissionDefinitionsCrud['Admin']['Read'][]> {
    const response = await this.sendAdminRequest(`/team-permission-definitions`, {}, null);
    const result = await response.json() as TeamPermissionDefinitionsCrud['Admin']['List'];
    return result.items;
  }

  async createTeamPermissionDefinition(data: TeamPermissionDefinitionsCrud['Admin']['Create']): Promise<TeamPermissionDefinitionsCrud['Admin']['Read']> {
    const response = await this.sendAdminRequest(
      "/team-permission-definitions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
    return await response.json();
  }

  async updateTeamPermissionDefinition(permissionId: string, data: TeamPermissionDefinitionsCrud['Admin']['Update']): Promise<TeamPermissionDefinitionsCrud['Admin']['Read']> {
    const response = await this.sendAdminRequest(
      `/team-permission-definitions/${permissionId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
    return await response.json();
  }

  async deleteTeamPermissionDefinition(permissionId: string): Promise<void> {
    await this.sendAdminRequest(
      `/team-permission-definitions/${permissionId}`,
      { method: "DELETE" },
      null,
    );
  }

  async listProjectPermissionDefinitions(): Promise<ProjectPermissionDefinitionsCrud['Admin']['Read'][]> {
    const response = await this.sendAdminRequest(`/project-permission-definitions`, {}, null);
    const result = await response.json() as ProjectPermissionDefinitionsCrud['Admin']['List'];
    return result.items;
  }

  async createProjectPermissionDefinition(data: ProjectPermissionDefinitionsCrud['Admin']['Create']): Promise<ProjectPermissionDefinitionsCrud['Admin']['Read']> {
    const response = await this.sendAdminRequest(
      "/project-permission-definitions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
    return await response.json();
  }

  async updateProjectPermissionDefinition(permissionId: string, data: ProjectPermissionDefinitionsCrud['Admin']['Update']): Promise<ProjectPermissionDefinitionsCrud['Admin']['Read']> {
    const response = await this.sendAdminRequest(
      `/project-permission-definitions/${permissionId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
    return await response.json();
  }

  async deleteProjectPermissionDefinition(permissionId: string): Promise<void> {
    await this.sendAdminRequest(
      `/project-permission-definitions/${permissionId}`,
      { method: "DELETE" },
      null,
    );
  }

  async getSvixToken(): Promise<SvixTokenCrud["Admin"]["Read"]> {
    const response = await this.sendAdminRequest(
      "/webhooks/svix-token",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      null,
    );
    return await response.json();
  }

  async deleteProject(): Promise<void> {
    await this.sendAdminRequest(
      "/internal/projects/current",
      {
        method: "DELETE",
      },
      null,
    );
  }

  async getMetrics(includeAnonymous: boolean = false): Promise<any> {
    const params = new URLSearchParams();
    if (includeAnonymous) {
      params.append('include_anonymous', 'true');
    }
    const queryString = params.toString();
    const response = await this.sendAdminRequest(
      `/internal/metrics${queryString ? `?${queryString}` : ''}`,
      {
        method: "GET",
      },
      null,
    );
    return await response.json();
  }

  async sendTestEmail(data: {
    recipient_email: string,
    email_config: {
      host: string,
      port: number,
      username: string,
      password: string,
      sender_email: string,
      sender_name: string,
    },
  }): Promise<{ success: boolean, error_message?: string }> {
    const response = await this.sendAdminRequest(`/internal/send-test-email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
    }, null);
    return await response.json();
  }

  async sendTestWebhook(data: {
    endpoint_id: string,
  }): Promise<{ success: boolean, error_message?: string }> {
    const response = await this.sendAdminRequest(`/internal/send-test-webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(data),
    }, null);
    return await response.json();
  }

  async listSentEmails(): Promise<InternalEmailsCrud["Admin"]["List"]> {
    const response = await this.sendAdminRequest("/internal/emails", {
      method: "GET",
    }, null);
    return await response.json();
  }

  async sendSignInInvitationEmail(
    email: string,
    callbackUrl: string,
  ): Promise<void> {
    await this.sendAdminRequest(
      "/internal/send-sign-in-invitation",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email,
          callback_url: callbackUrl,
        }),
      },
      null,
    );
  }


  async sendChatMessage(
    threadId: string,
    contextType: "email-theme" | "email-template" | "email-draft",
    messages: Array<{ role: string, content: any }>,
    abortSignal?: AbortSignal,
  ): Promise<{ content: ChatContent }> {
    const response = await this.sendAdminRequest(
      `/internal/ai-chat/${threadId}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ context_type: contextType, messages }),
        signal: abortSignal,
      },
      null,
    );
    return await response.json();
  }

  async saveChatMessage(threadId: string, message: any): Promise<void> {
    await this.sendAdminRequest(
      `/internal/ai-chat/${threadId}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ message }),
      },
      null,
    );
  }

  async listChatMessages(threadId: string): Promise<{ messages: Array<any> }> {
    const response = await this.sendAdminRequest(
      `/internal/ai-chat/${threadId}`,
      { method: "GET" },
      null,
    );
    return await response.json();
  }

  async renderEmailPreview(options: { themeId?: string | null | false, themeTsxSource?: string, templateId?: string, templateTsxSource?: string }): Promise<{ html: string }> {
    const response = await this.sendAdminRequest(`/emails/render-email`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        theme_id: options.themeId,
        theme_tsx_source: options.themeTsxSource,
        template_id: options.templateId,
        template_tsx_source: options.templateTsxSource,
      }),
    }, null);
    return await response.json();
  }

  async createEmailTheme(displayName: string): Promise<{ id: string }> {
    const response = await this.sendAdminRequest(
      `/internal/email-themes`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          display_name: displayName,
        }),
      },
      null,
    );
    return await response.json();
  }

  async getEmailTheme(id: string): Promise<{ display_name: string, tsx_source: string }> {
    const response = await this.sendAdminRequest(
      `/internal/email-themes/${id}`,
      { method: "GET" },
      null,
    );
    return await response.json();
  }

  async updateEmailTheme(id: string, tsxSource: string): Promise<void> {
    await this.sendAdminRequest(
      `/internal/email-themes/${id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          tsx_source: tsxSource,
        }),
      },
      null,
    );
  }

  async updateEmailTemplate(id: string, tsxSource: string, themeId: string | null | false): Promise<{ rendered_html: string }> {
    const response = await this.sendAdminRequest(
      `/internal/email-templates/${id}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ tsx_source: tsxSource, theme_id: themeId }),
      },
      null,
    );
    return await response.json();
  }

  async getConfig(): Promise<{ config_string: string }> {
    const response = await this.sendAdminRequest(
      `/internal/config`,
      { method: "GET" },
      null,
    );
    return await response.json();
  }

  async updateConfig(data: { configOverride: any }): Promise<void> {
    const response = await this.sendAdminRequest(
      `/internal/config/override`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ config_override_string: JSON.stringify(data.configOverride) }),
      },
      null,
    );
  }
  async createEmailTemplate(displayName: string): Promise<{ id: string }> {
    const response = await this.sendAdminRequest(
      `/internal/email-templates`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          display_name: displayName,
        }),
      },
      null,
    );
    return await response.json();
  }

  async setupPayments(): Promise<{ url: string }> {
    const response = await this.sendAdminRequest(
      "/internal/payments/setup",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      null,
    );
    return await response.json();
  }

  async getStripeAccountInfo(): Promise<null | { account_id: string, charges_enabled: boolean, details_submitted: boolean, payouts_enabled: boolean }> {
    const response = await this.sendAdminRequestAndCatchKnownError(
      "/internal/payments/stripe/account-info",
      {},
      null,
      [KnownErrors.StripeAccountInfoNotFound],
    );
    if (response.status === "error") {
      return null;
    }
    return await response.data.json();
  }

  async createStripeWidgetAccountSession(): Promise<{ client_secret: string }> {
    const response = await this.sendAdminRequest(
      "/internal/payments/stripe-widgets/account-session",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
      null,
    );
    return await response.json();
  }

  async listTransactions(params?: { cursor?: string, limit?: number, type?: TransactionType, customerType?: 'user' | 'team' | 'custom' }): Promise<{ transactions: Transaction[], nextCursor: string | null }> {
    const qs = new URLSearchParams();
    if (params?.cursor) qs.set('cursor', params.cursor);
    if (typeof params?.limit === 'number') qs.set('limit', String(params.limit));
    if (params?.type) qs.set('type', params.type);
    if (params?.customerType) qs.set('customer_type', params.customerType);
    const response = await this.sendAdminRequest(
      `/internal/payments/transactions${qs.size ? `?${qs.toString()}` : ''}`,
      { method: 'GET' },
      null,
    );
    const json = await response.json() as { transactions: Transaction[], next_cursor: string | null };
    return { transactions: json.transactions, nextCursor: json.next_cursor };
  }

  async refundTransaction(options: { type: "subscription" | "one-time-purchase", id: string, amountUsd?: MoneyAmount }): Promise<{ success: boolean }> {
    const response = await this.sendAdminRequest(
      "/internal/payments/transactions/refund",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          type: options.type,
          id: options.id,
          amount_usd: options.amountUsd,
        }),
      },
      null,
    );
    return await response.json();
  }

  async previewAffectedUsersByOnboardingChange(
    onboarding: { require_email_verification?: boolean },
    limit?: number,
  ): Promise<{
    affected_users: Array<{
      id: string,
      display_name: string | null,
      primary_email: string | null,
      restricted_reason: { type: "anonymous" | "email_not_verified" },
    }>,
    total_affected_count: number,
  }> {
    const response = await this.sendAdminRequest(
      `/internal/onboarding/preview-affected-users${limit ? `?limit=${limit}` : ''}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ onboarding }),
      },
      null,
    );
    return await response.json();
  }


  async listOutboxEmails(options?: { status?: string, simple_status?: string, limit?: number, cursor?: string }): Promise<EmailOutboxCrud["Server"]["List"]> {
    const qs = new URLSearchParams();
    if (options?.status) qs.set('status', options.status);
    if (options?.simple_status) qs.set('simple_status', options.simple_status);
    if (options?.limit !== undefined) qs.set('limit', options.limit.toString());
    if (options?.cursor) qs.set('cursor', options.cursor);
    const response = await this.sendServerRequest(
      `/emails/outbox${qs.size ? `?${qs.toString()}` : ''}`,
      { method: 'GET' },
      null,
    );
    return await response.json();
  }

  async getOutboxEmail(id: string): Promise<EmailOutboxCrud["Server"]["Read"]> {
    const response = await this.sendServerRequest(
      `/emails/outbox/${id}`,
      { method: 'GET' },
      null,
    );
    return await response.json();
  }

  async updateOutboxEmail(id: string, data: EmailOutboxCrud["Server"]["Update"]): Promise<EmailOutboxCrud["Server"]["Read"]> {
    const response = await this.sendServerRequest(
      `/emails/outbox/${id}`,
      {
        method: 'PATCH',
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(data),
      },
      null,
    );
    return await response.json();
  }

}
