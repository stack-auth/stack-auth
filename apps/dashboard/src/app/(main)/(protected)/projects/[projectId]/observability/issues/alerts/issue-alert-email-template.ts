import { escapeHtml } from "@hexclave/shared/dist/utils/html";
import { deindent } from "@hexclave/shared/dist/utils/strings";

/**
 * Tokens authors can put in an issue-alert subject or HTML body. The backend
 * substitutes the same names from the triggering issue when the email is
 * enqueued. Keep this list aligned with
 * `apps/backend/src/lib/issues/issue-alerts/email-template.ts`.
 *
 * Unknown `{{tokens}}` are left untouched so a typo is visible in the sent
 * mail instead of silently disappearing.
 */
export const ISSUE_ALERT_EMAIL_PLACEHOLDER_TOKENS = [
  "short_id",
  "type",
  "summary",
  "culprit",
  "environment",
  "release",
  "status",
  "kind",
  "occurred_at",
  "issue_url",
] as const;

export type IssueAlertEmailPlaceholderToken = typeof ISSUE_ALERT_EMAIL_PLACEHOLDER_TOKENS[number];

export const ISSUE_ALERT_EMAIL_PLACEHOLDERS: readonly {
  token: IssueAlertEmailPlaceholderToken,
  hint: string,
}[] = [
  { token: "short_id", hint: "Per-project issue number" },
  { token: "type", hint: "Error type, for example TypeError" },
  { token: "summary", hint: "Error message" },
  { token: "culprit", hint: "Code location" },
  { token: "environment", hint: "production, staging, …" },
  { token: "release", hint: "Release that reported it" },
  { token: "status", hint: "unresolved, resolved, or ignored" },
  { token: "kind", hint: "New issue, regression, or frequency" },
  { token: "occurred_at", hint: "When this occurrence was seen" },
  { token: "issue_url", hint: "Dashboard link to the issue" },
];

const PLACEHOLDER_PATTERN = /\{\{([a-z_]+)\}\}/g;
const KNOWN_PLACEHOLDER_TOKENS: ReadonlySet<string> = new Set(ISSUE_ALERT_EMAIL_PLACEHOLDER_TOKENS);

function isPlaceholderToken(name: string): name is IssueAlertEmailPlaceholderToken {
  return KNOWN_PLACEHOLDER_TOKENS.has(name);
}

export const DEFAULT_ISSUE_ALERT_EMAIL_SUBJECT = "[{{kind}}] {{short_id}}: {{summary}}";

export const DEFAULT_ISSUE_ALERT_EMAIL_HTML = deindent`
  <div style="font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif; font-size: 14px; line-height: 1.5; color: #111827; max-width: 560px;">
    <p style="margin: 0 0 4px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #6b7280;">Hexclave issue alert · {{kind}}</p>
    <p style="margin: 0 0 4px; font-size: 12px; color: #6b7280;">{{type}} · {{short_id}}</p>
    <p style="margin: 0 0 12px; font-size: 18px; font-weight: 600; color: #111827;">{{summary}}</p>
    <p style="margin: 0 0 16px; color: #4b5563;">{{culprit}}</p>
    <table style="border-collapse: collapse; font-size: 13px; color: #374151;">
      <tr>
        <td style="padding: 3px 20px 3px 0; color: #6b7280;">Status</td>
        <td>{{status}}</td>
      </tr>
      <tr>
        <td style="padding: 3px 20px 3px 0; color: #6b7280;">Environment</td>
        <td>{{environment}}</td>
      </tr>
      <tr>
        <td style="padding: 3px 20px 3px 0; color: #6b7280;">Release</td>
        <td>{{release}}</td>
      </tr>
      <tr>
        <td style="padding: 3px 20px 3px 0; color: #6b7280;">Seen</td>
        <td>{{occurred_at}}</td>
      </tr>
    </table>
    <p style="margin: 20px 0 0;">
      <a href="{{issue_url}}" style="color: #2563eb; font-weight: 600; text-decoration: none;">Open this issue in Hexclave →</a>
    </p>
  </div>
`;

export function interpolateIssueAlertEmailTemplate(
  template: string,
  values: ReadonlyMap<IssueAlertEmailPlaceholderToken, string>,
  options: { escapeHtml: boolean },
): string {
  return template.replace(PLACEHOLDER_PATTERN, (match, name: string) => {
    if (!isPlaceholderToken(name)) return match;
    const value = values.get(name);
    if (value == null) return match;
    return options.escapeHtml ? escapeHtml(value) : value;
  });
}

export function createIssueAlertEmailPreviewValues(options: {
  projectId: string,
  dashboardOrigin: string,
}): Map<IssueAlertEmailPlaceholderToken, string> {
  const issueId = "3983534c-b596-44df-87a5-3962ec74a14a";
  const origin = options.dashboardOrigin.replace(/\/+$/u, "");
  return new Map<IssueAlertEmailPlaceholderToken, string>([
    ["short_id", "1842"],
    ["type", "TypeError"],
    ["summary", "Cannot read properties of undefined (reading 'id')"],
    ["culprit", "checkout.ts in submitOrder"],
    ["environment", "production"],
    ["release", "web@2026.08.12"],
    ["status", "unresolved"],
    ["kind", "New issue"],
    ["occurred_at", "2026-08-12 19:04 UTC"],
    ["issue_url", `${origin}/projects/${options.projectId}/observability/issues/${issueId}`],
  ]);
}
