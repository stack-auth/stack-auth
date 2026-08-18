// The placeholder vocabulary and interpolation semantics are a cross-app
// contract shared with the dashboard's alert-email editor, so they live in
// `@hexclave/shared` (utils/issue-alert-email-template). This module only
// re-exports them under the path the issue-alert pipeline already imports.
export {
  ISSUE_ALERT_EMAIL_PLACEHOLDER_TOKENS,
  interpolateIssueAlertEmailTemplate,
  type IssueAlertEmailPlaceholderToken,
} from "@hexclave/shared/dist/utils/issue-alert-email-template";
