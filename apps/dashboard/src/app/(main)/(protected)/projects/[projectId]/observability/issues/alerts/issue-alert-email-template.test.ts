import { describe, expect, it } from "vitest";
import {
  createIssueAlertEmailPreviewValues,
  DEFAULT_ISSUE_ALERT_EMAIL_HTML,
  DEFAULT_ISSUE_ALERT_EMAIL_SUBJECT,
  interpolateIssueAlertEmailTemplate,
  ISSUE_ALERT_EMAIL_PLACEHOLDERS,
  type IssueAlertEmailPlaceholderToken,
} from "./issue-alert-email-template";

function sampleValues(): Map<IssueAlertEmailPlaceholderToken, string> {
  return new Map<IssueAlertEmailPlaceholderToken, string>([
    ["short_id", "12"],
    ["type", "TypeError"],
    ["summary", "<script>alert(1)</script>"],
    ["culprit", "app.ts"],
    ["environment", "production"],
    ["release", "1.0.0"],
    ["status", "unresolved"],
    ["kind", "New issue"],
    ["occurred_at", "2026-08-12 19:04 UTC"],
    ["issue_url", "https://app.example.test/issues/12"],
  ]);
}

describe("issue-alert email templates", () => {
  it("substitutes known placeholders and HTML-escapes values in the body", () => {
    const values = sampleValues();

    expect(interpolateIssueAlertEmailTemplate(
      "Issue {{short_id}}: {{summary}} {{unknown}}",
      values,
      { escapeHtml: false },
    )).toBe("Issue 12: <script>alert(1)</script> {{unknown}}");
    expect(interpolateIssueAlertEmailTemplate(
      "<p>{{summary}}</p><a href=\"{{issue_url}}\">open</a>",
      values,
      { escapeHtml: true },
    )).toBe("<p>&lt;script&gt;alert(1)&lt;/script&gt;</p><a href=\"https://app.example.test/issues/12\">open</a>");
  });

  it("covers every advertised placeholder in the default subject and HTML", () => {
    const values = createIssueAlertEmailPreviewValues({
      projectId: "project-1",
      dashboardOrigin: "https://app.hexclave.com",
    });
    const subject = interpolateIssueAlertEmailTemplate(DEFAULT_ISSUE_ALERT_EMAIL_SUBJECT, values, { escapeHtml: false });
    const html = interpolateIssueAlertEmailTemplate(DEFAULT_ISSUE_ALERT_EMAIL_HTML, values, { escapeHtml: true });

    expect(subject).toBe("[New issue] 1842: Cannot read properties of undefined (reading 'id')");
    expect(html).toContain("Open this issue in Hexclave");
    expect(html).toContain("/projects/project-1/observability/issues/");
    for (const placeholder of ISSUE_ALERT_EMAIL_PLACEHOLDERS) {
      expect(DEFAULT_ISSUE_ALERT_EMAIL_SUBJECT.includes(`{{${placeholder.token}}}`)
        || DEFAULT_ISSUE_ALERT_EMAIL_HTML.includes(`{{${placeholder.token}}}`)).toBe(true);
      expect(html).not.toContain(`{{${placeholder.token}}}`);
    }
  });
});
