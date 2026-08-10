/**
 * Alert destinations are references, not provider credentials. Provider
 * configuration belongs to a future integration registry; keeping only an
 * opaque id in the rule prevents secrets and arbitrary URLs from entering
 * the durable rule or Workflows payload.
 */

export type IssueAlertEmailAction = {
  type: "email",
  /** Explicit project-user recipients. Kept as the supported execution path. */
  userIds?: readonly string[],
  /**
   * Sentry-style routing intent. Ingestion hydrates this against the current
   * tenant/project/branch/issue snapshot and carries only the bounded result
   * across the durable Workflows boundary.
   */
  routing?: IssueAlertEmailRouting,
  subject: string,
  html: string,
  notificationCategoryName?: string,
};

export type IssueAlertEmailRouting =
  | { type: "team", teamId: string }
  | { type: "issue_owners", fallthrough: IssueAlertOwnerFallthrough };

export type IssueAlertOwnerFallthrough = "active_members" | "all_members" | "none";

export type IssueAlertWebhookAction = {
  type: "webhook",
  integrationId: string,
};

export type IssueAlertAction = IssueAlertEmailAction | IssueAlertWebhookAction;

const MAX_IDENTIFIER_BYTES = 256;
const MAX_RECIPIENTS = 64;
const MAX_TEXT_BYTES = 16 * 1024;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const SAFE_INTEGRATION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,255}$/u;
const TEXT_ENCODER = new TextEncoder();
const ISSUE_ALERT_OWNER_FALLTHROUGHS: readonly IssueAlertOwnerFallthrough[] = ["active_members", "all_members", "none"];

function isIssueAlertOwnerFallthrough(value: unknown): value is IssueAlertOwnerFallthrough {
  return typeof value === "string" && ISSUE_ALERT_OWNER_FALLTHROUGHS.some((candidate) => candidate === value);
}

function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isBoundedText(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string"
    && value.length > 0
    && !CONTROL_CHARACTER_PATTERN.test(value)
    && TEXT_ENCODER.encode(value).byteLength <= maximumBytes;
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_RECIPIENTS) return null;
  const result: string[] = [];
  for (const entry of value) {
    if (!isBoundedText(entry, MAX_IDENTIFIER_BYTES) || result.includes(entry)) return null;
    result.push(entry);
  }
  return result;
}

function parseEmailRouting(value: unknown): IssueAlertEmailRouting | null {
  if (!isObject(value) || typeof value.type !== "string") return null;
  if (value.type === "team") {
    return isBoundedText(value.teamId, MAX_IDENTIFIER_BYTES) && SAFE_INTEGRATION_ID.test(value.teamId)
      ? { type: "team", teamId: value.teamId }
      : null;
  }
  if (value.type === "issue_owners" && isIssueAlertOwnerFallthrough(value.fallthrough)) {
    return { type: "issue_owners", fallthrough: value.fallthrough };
  }
  return null;
}

/** Parse and normalize the only actions allowed to cross the durable boundary. */
export function parseIssueAlertAction(value: unknown): IssueAlertAction | null {
  if (!isObject(value) || typeof value.type !== "string") return null;

  if (value.type === "email") {
    const userIds = value.userIds === undefined ? undefined : parseStringArray(value.userIds);
    const routing = value.routing === undefined ? undefined : parseEmailRouting(value.routing);
    if ((userIds === undefined) === (routing === undefined)
      || userIds === null
      || routing === null
      || !isBoundedText(value.subject, MAX_TEXT_BYTES)
      || !isBoundedText(value.html, MAX_TEXT_BYTES)) return null;
    if (value.notificationCategoryName !== undefined && !isBoundedText(value.notificationCategoryName, MAX_IDENTIFIER_BYTES)) return null;
    return {
      type: "email",
      ...(userIds === undefined ? {} : { userIds }),
      ...(routing === undefined ? {} : { routing }),
      subject: value.subject,
      html: value.html,
      ...(value.notificationCategoryName === undefined ? {} : { notificationCategoryName: value.notificationCategoryName }),
    };
  }

  if (value.type === "webhook" && isBoundedText(value.integrationId, MAX_IDENTIFIER_BYTES) && SAFE_INTEGRATION_ID.test(value.integrationId)) {
    return { type: "webhook", integrationId: value.integrationId };
  }

  return null;
}

export function isIssueAlertAction(value: unknown): value is IssueAlertAction {
  return parseIssueAlertAction(value) !== null;
}

export type IssueAlertDestinationExecution =
  | { status: "supported", destination: "email", routing: "users" | "team" | "issue_owners" }
  | { status: "unsupported", destination: "webhook", reason: "provider_not_configured" };

/** Describe the configured execution path without attempting a provider call. */
export function describeIssueAlertDestination(action: IssueAlertAction): IssueAlertDestinationExecution {
  if (action.type === "webhook") return { status: "unsupported", destination: "webhook", reason: "provider_not_configured" };
  if (action.userIds !== undefined) return { status: "supported", destination: "email", routing: "users" };
  if (action.routing?.type === "team") return { status: "supported", destination: "email", routing: "team" };
  return { status: "supported", destination: "email", routing: "issue_owners" };
}
