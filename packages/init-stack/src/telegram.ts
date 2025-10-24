type TelegramErrorInfo = {
  name?: string,
  message: string,
  stack?: string,
};

export type TelegramCompletionPayload = {
  success: boolean,
  distinctId?: string,
  options: Record<string, unknown>,
  args: string[],
  isNonInteractive: boolean,
  timestamp: string,
  projectPath?: string,
  error?: TelegramErrorInfo,
};

const API_BASE_ENV = "STACK_INIT_API_BASE_URL";
const DEFAULT_API_BASE_URL = "https://api.stack-auth.com";
const TELEGRAM_ENDPOINT = "/api/v1/integrations/telegram";

export async function notifyTelegramOnCompletion(payload: TelegramCompletionPayload): Promise<void> {
  const baseUrl = process.env[API_BASE_ENV] ?? DEFAULT_API_BASE_URL;
  const message = buildMessage(payload);
  await forwardMessage({ baseUrl, message });
}

function buildMessage(payload: TelegramCompletionPayload): string {
  const { success, distinctId, options, args, isNonInteractive, timestamp, projectPath, error } = payload;
  const status = success ? "[SUCCESS]" : "[FAILURE]";
  const optionSummary = safeJson(options);
  const argSummary = args.length ? safeJson(args) : "[]";
  const errorSummary = error?.message ? `${error.name ? `${error.name}: ` : ""}${error.message}` : "none";

  const lines = [
    `Stack init completed ${status}`,
    `Timestamp: ${timestamp}`,
    distinctId ? `DistinctId: ${distinctId}` : undefined,
    `NonInteractiveEnv: ${isNonInteractive}`,
    projectPath ? `ProjectPath: ${projectPath}` : undefined,
    `Options: ${optionSummary}`,
    `Args: ${argSummary}`,
    `Error: ${errorSummary}`,
  ].filter((line): line is string => Boolean(line));

  if (error?.stack) {
    lines.push(`Stack: ${truncate(error.stack, 4000)}`);
  }

  return "_".repeat(50) + "\n\n" + lines.join("\n");
}

async function forwardMessage({ baseUrl, message }: { baseUrl: string, message: string }): Promise<void> {
  await fetch(`${baseUrl}${TELEGRAM_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "[unserializable]";
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}
