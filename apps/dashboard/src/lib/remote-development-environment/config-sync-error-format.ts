import { errorToNiceString } from "@hexclave/shared/dist/utils/errors";

const CONFIG_SYNC_CLI_ERROR_MAX_LENGTH = 500;

function stripAnsiEscapeSequences(value: string): string {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function normalizeSingleLineErrorMessage(value: string): string {
  return stripAnsiEscapeSequences(value)
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^Error:\s+/, "");
}

function truncateConfigSyncCliErrorMessage(value: string): string {
  if (value.length <= CONFIG_SYNC_CLI_ERROR_MAX_LENGTH) {
    return value;
  }
  return `${value.slice(0, CONFIG_SYNC_CLI_ERROR_MAX_LENGTH - 1)}…`;
}

function extractConfigSyncErrorSummary(error: unknown): string {
  const rawMessage = error instanceof Error && error.message.length > 0
    ? error.message
    : errorToNiceString(error);

  const messageBeforeStack = rawMessage
    .split(/\n\s*Stack:/)[0]
    .split(/\n\s*Cause:/)[0];
  const failedRequestMatch = /Failed to send request to \S+:\s*(\d{3})\s+([\s\S]+)/.exec(messageBeforeStack);
  const summary = failedRequestMatch == null
    ? messageBeforeStack
    : failedRequestMatch[2];
  const normalizedSummary = normalizeSingleLineErrorMessage(summary);
  if (normalizedSummary.length === 0) {
    return "The config file could not be synced.";
  }
  return truncateConfigSyncCliErrorMessage(normalizedSummary);
}

export function formatConfigSyncErrorForCli(configFilePath: string, error: unknown): string {
  const summary = extractConfigSyncErrorSummary(error);
  return `Config file error: ${summary} Please check your config file at ${configFilePath}.`;
}
