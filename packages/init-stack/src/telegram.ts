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
const CALLBACK_ENDPOINT = "/api/latest/internal/init-script-callback";

export async function invokeCallback(payload: TelegramCompletionPayload): Promise<void> {
  const baseUrl = process.env[API_BASE_ENV] ?? DEFAULT_API_BASE_URL;
  await fetch(`${baseUrl}${CALLBACK_ENDPOINT}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}
