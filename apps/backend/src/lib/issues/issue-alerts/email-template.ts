import { escapeHtml } from "@hexclave/shared/dist/utils/html";

/**
 * Keep this token list aligned with the dashboard editor in
 * `issue-alert-email-template.ts`. The dashboard documents these names; this
 * module is what actually fills them when an alert is enqueued.
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

const PLACEHOLDER_PATTERN = /\{\{([a-z_]+)\}\}/g;
const KNOWN_PLACEHOLDER_TOKENS: ReadonlySet<string> = new Set(ISSUE_ALERT_EMAIL_PLACEHOLDER_TOKENS);

function isPlaceholderToken(name: string): name is IssueAlertEmailPlaceholderToken {
  return KNOWN_PLACEHOLDER_TOKENS.has(name);
}

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
