import { InternalSession } from "../sessions";
import { InternalEmailsCrud } from "./crud/emails";
import { InternalApiKeysCrud } from "./crud/internal-api-keys";
import { ProjectPermissionDefinitionsCrud } from "./crud/project-permissions";
import { ProjectsCrud } from "./crud/projects";
import { SvixTokenCrud } from "./crud/svix-token";
import { TeamPermissionDefinitionsCrud } from "./crud/team-permissions";
import { ServerAuthApplicationOptions, StackServerInterface } from "./server-interface";

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

  async getMetrics(): Promise<any> {
    const response = await this.sendAdminRequest(
      "/internal/metrics",
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

  async listSentEmails(): Promise<InternalEmailsCrud["Admin"]["List"]> {
    const response = await this.sendAdminRequest("/internal/emails", {
      method: "GET",
    }, null);
    return await response.json();
  }

  async sendEmail(options: {
    user_ids: string[],
    subject: string,
    html: string,
    notification_category_name: string,
  }): Promise<void> {
    await this.sendAdminRequest("/emails/send-email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(options),
    }, null);
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
    contextType: "email-theme" | "email-template",
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

}
