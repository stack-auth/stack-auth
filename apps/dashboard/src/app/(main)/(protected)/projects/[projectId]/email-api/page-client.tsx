"use client";

import { CodeBlock } from "@/components/code-block";
import { StyledLink } from "@/components/link";
import {
  DesignAlert,
  DesignCard,
} from "@/components/design-components";
import { CopyPromptButton } from "@/components/ui";
import { LinkIcon, MailboxIcon, SparkleIcon } from "@phosphor-icons/react";
import type { AdminEmailOutbox } from "@hexclave/next";
import {
  DataGrid,
  useDataGridUrlState,
  type DataGridColumnDef,
} from "@hexclave/dashboard-ui-components";
import { useCallback, useMemo } from "react";
import { ALL_APPS_FRONTEND, getItemPath } from "@/lib/apps-frontend";
import { AppEnabledGuard } from "../app-enabled-guard";
import { PageLayout } from "../page-layout";
import { useAdminApp } from "../use-admin-app";
import { STATUS_LABELS, getStatusBadgeColor } from "../email-sent/email-status-utils";
import { SentEmailsView } from "../email-sent/sent-emails-view";
import { countEmailsSince, getDeliverySuccessRate, groupEmailsBySource, isEmailApiEmail, type EmailApiSource } from "./email-api-logic";

const DAY = 24 * 60 * 60 * 1000;

function formatDate(date: Date | null): string {
  return date == null ? "Never" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const sourceColumns: DataGridColumnDef<EmailApiSource>[] = [
  { id: "source", header: "Source", flex: 1, minWidth: 150, type: "string", accessor: (row) => row.displayName },
  { id: "count", header: "Sends", width: 90, type: "number", accessor: (row) => row.count },
  { id: "lastSentAt", header: "Last sent", width: 190, type: "string", accessor: (row) => formatDate(row.lastSentAt) },
  {
    id: "status",
    header: "Status",
    flex: 1,
    minWidth: 180,
    type: "string",
    accessor: (row) => Object.entries(row.statuses).map(([status, count]) => `${STATUS_LABELS[status as keyof typeof STATUS_LABELS]}: ${count}`).join(" · "),
  },
];

function ApiStatsAndSources({ emails, templateNames }: {
  emails: AdminEmailOutbox[],
  templateNames: ReadonlyMap<string, string>,
}) {
  const now = useMemo(() => new Date(), []);
  const sources = useMemo(() => groupEmailsBySource(emails, templateNames), [emails, templateNames]);
  const [gridState, setGridState] = useDataGridUrlState(sourceColumns, {
    paramPrefix: "emailsource",
    initial: { sorting: [{ columnId: "count", direction: "desc" }] },
  });
  const windows = [
    ["24h", countEmailsSince(emails, now, DAY)],
    ["7d", countEmailsSince(emails, now, 7 * DAY)],
    ["30d", countEmailsSince(emails, now, 30 * DAY)],
  ];
  const successRate = Math.round(getDeliverySuccessRate(emails) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[...windows, ["Success", `${successRate}%`]].map(([label, value]) => (
          <DesignCard key={label} glassmorphic contentClassName="p-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
            <div className="mt-1 text-xl font-semibold">{value}</div>
          </DesignCard>
        ))}
      </div>
      <DesignCard title="By source" subtitle="API sends grouped by raw HTML or template" icon={MailboxIcon} glassmorphic contentClassName="p-3">
        {sources.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">
            No Email API sends yet. Run one of the examples above to see delivery sources here.
          </div>
        ) : (
          <DataGrid<EmailApiSource>
            columns={sourceColumns}
            rows={sources}
            getRowId={(row) => row.id}
            totalRowCount={sources.length}
            state={gridState}
            onChange={setGridState}
            fillHeight={false}
            footer={false}
          />
        )}
      </DesignCard>
    </div>
  );
}

function PromptCard({ title, prompt }: { title: string, prompt: string }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-border/60 bg-foreground/[0.02] p-3">
      <div className="min-w-0">
        <div className="mb-1 text-sm font-medium">{title}</div>
        <p className="text-xs leading-relaxed text-muted-foreground">{prompt}</p>
      </div>
      <CopyPromptButton content={prompt} aria-label={`Copy ${title} prompt`} className="shrink-0">
        <SparkleIcon className="text-purple-500 dark:text-purple-400" />
      </CopyPromptButton>
    </div>
  );
}

export default function PageClient() {
  const adminApp = useAdminApp();
  const project = adminApp.useProject();
  const templates = adminApp.useEmailTemplates();
  const templateNames = useMemo(
    () => new Map(templates.map((template) => [template.id, template.displayName])),
    [templates],
  );
  const templateId = templates[0]?.id ?? "replace-with-template-id";
  const emailSettingsHref = getItemPath(project.id, ALL_APPS_FRONTEND.emails, ALL_APPS_FRONTEND.emails.navigationItems[3]);

  const filterFn = useCallback((email: AdminEmailOutbox) => isEmailApiEmail(email), []);
  const snippets = useMemo(() => ({
    setup: `pnpm add @hexclave/next\n\n# .env\nNEXT_PUBLIC_HEXCLAVE_PROJECT_ID=${project.id}\nHEXCLAVE_SECRET_SERVER_KEY=your_server_key`,
    html: `import { hexclaveServerApp } from "@hexclave/next/server";\n\nawait hexclaveServerApp.sendEmail({\n  userIds: ["user-id"],\n  subject: "Welcome to Acme",\n  html: "<h1>Welcome!</h1><p>Thanks for joining.</p>",\n});`,
    template: `await hexclaveServerApp.sendEmail({\n  userIds: ["user-id"],\n  templateId: "${templateId}",\n  variables: { firstName: "Ada", plan: "Pro" },\n});`,
    emails: `await hexclaveServerApp.sendEmail({\n  emails: ["customer@example.com"],\n  subject: "Your receipt",\n  html: "<p>Thanks for your purchase.</p>",\n});\n// Arbitrary addresses cannot unsubscribe; use this for transactional mail only.`,
    curl: `curl -X POST https://api.hexclave.com/api/v1/emails/send-email \\\n  -H "Content-Type: application/json" \\\n  -H "X-Stack-Access-Type: server" \\\n  -H "X-Stack-Project-Id: ${project.id}" \\\n  -H "X-Stack-Secret-Server-Key: $HEXCLAVE_SECRET_SERVER_KEY" \\\n  -d '${JSON.stringify({ user_ids: ["user-id"], template_id: templateId, variables: { firstName: "Ada" } })}'`,
  }), [project.id, templateId]);

  const prompts = [
    ["Welcome email on signup", `In project ${project.id}, implement a server-side signup flow that sends a transactional welcome email through hexclaveServerApp.sendEmail to the newly created user's ID. Use raw HTML, include a subject, keep the server key out of client bundles, and make the send failure observable without blocking the signup response.`],
    ["Templated notification", `In project ${project.id}, send a notification with the Email API using template ${templateId}. Pass variables firstName and plan, validate the variables before sending, and show me the exact server-only TypeScript code plus a test that proves the template ID and variables are forwarded.`],
    ["Scheduled announcement", `For project ${project.id}, schedule an announcement to all users with hexclaveServerApp.sendEmail. Use a template when available, set scheduledAt to an explicit future Date, and explain how to inspect the resulting outbox rows and safely retry failures.`],
    ["Unsubscribe-aware marketing", `Design an unsubscribe-respecting marketing send for project ${project.id}. Use a notification category name so opted-out users are skipped, send only to user IDs rather than arbitrary emails, and include the server-side implementation, consent assumptions, and a verification checklist.`],
    ["Read delivery status", `For project ${project.id}, add an admin-only diagnostic that reads the email outbox after an Email API send and reports queued, sent, bounced, and error statuses. Do not expose the server key or internal error details, and include pagination and a useful retry recommendation.`],
  ];

  return (
    <AppEnabledGuard appId="email-api">
      <PageLayout title="Email API" description="Send transactional email from your server and monitor delivery">
        <DesignAlert
          variant="info"
          title="Server-side email delivery"
          description={<>
            The Email API queues messages from trusted server code. Keep your server key private and configure a custom email server before sending; the shared development server cannot deliver email.
            <br /><br />
            Configure delivery in <StyledLink href={emailSettingsHref}>Email Settings</StyledLink> and manage credentials in <StyledLink href={`/projects/${project.id}/project-keys`}>API Keys</StyledLink>. Read the <StyledLink href="https://docs.hexclave.com/guides/apps/emails/overview">Email API documentation</StyledLink> for the full guide.
          </>}
        />

        <DesignCard title="Usage" subtitle="Copy a complete example into your server application" icon={LinkIcon} glassmorphic>
          <div className="flex flex-col gap-4">
            <CodeBlock language="bash" title="Install and configure" content={snippets.setup} icon="code" />
            <CodeBlock language="typescript" title="Send raw HTML to users" content={snippets.html} icon="code" />
            <CodeBlock language="typescript" title={templates.length > 0 ? `Send template (${templates[0].displayName})` : "Send a template"} content={snippets.template} icon="code" />
            {templates.length === 0 && <p className="text-xs text-muted-foreground">No email templates exist yet, so the example uses a placeholder ID. Create one in Email Templates, then replace it before running the snippet.</p>}
            <CodeBlock language="typescript" title="Send to arbitrary email addresses" content={snippets.emails} icon="code" />
            <CodeBlock language="bash" title="REST API with curl" content={snippets.curl} icon="code" />
          </div>
        </DesignCard>

        <DesignCard title="Prompts" subtitle="Ready-to-paste tasks for your AI coding agent" icon={SparkleIcon} glassmorphic>
          <div className="flex flex-col gap-2">
            {prompts.map(([title, prompt]) => <PromptCard key={title} title={title} prompt={prompt} />)}
          </div>
        </DesignCard>

        <SentEmailsView
          filterFn={filterFn}
          renderActions={(emails) => (
            <ApiStatsAndSources emails={emails} templateNames={templateNames} />
          )}
        />
      </PageLayout>
    </AppEnabledGuard>
  );
}
