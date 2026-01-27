import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";

const TELEGRAM_HOSTNAME = "api.telegram.org";
const TELEGRAM_ENDPOINT_PATH = "/sendMessage";

export type TelegramConfig = {
  botToken: string,
  chatId: string,
};

export function getTelegramConfig(chatChannel: "init-stack" | "chargebacks"): TelegramConfig | null {
  const botToken = getEnvVariable("STACK_TELEGRAM_BOT_TOKEN", "");
  const chatIdEnv = chatChannel === "init-stack" ? "STACK_TELEGRAM_CHAT_ID" : "STACK_TELEGRAM_CHAT_ID_CHARGEBACKS";
  const chatId = getEnvVariable(chatIdEnv, "");
  if (!botToken || !chatId) {
    return null;
  }
  return { botToken, chatId };
}

export async function sendTelegramMessage(options: TelegramConfig & { message: string }): Promise<void> {
  const response = await fetch(`https://${TELEGRAM_HOSTNAME}/bot${options.botToken}${TELEGRAM_ENDPOINT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: options.chatId,
      text: options.message,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new StackAssertionError("Failed to send Telegram notification.", {
      status: response.status,
      body,
    });
  }
}
