import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { InferType } from "yup";

const TELEGRAM_HOSTNAME = "api.telegram.org";
const TELEGRAM_ENDPOINT_PATH = "/sendMessage";
const STACK_TRACE_MAX_LENGTH = 4000;
const MESSAGE_PREFIX = "_".repeat(50);


const completionPayloadSchema = yupObject({
  success: yupBoolean().defined(),
  distinctId: yupString().optional(),
  options: adaptSchema.defined(),
  args: yupArray(yupString().defined()).defined(),
  isNonInteractive: yupBoolean().defined(),
  timestamp: yupString().defined(),
  projectPath: yupString().optional(),
  error: yupObject({
    name: yupString().optional(),
    message: yupString().defined(),
    stack: yupString().optional(),
  }).optional(),
}).defined();

export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema,
      project: adaptSchema,
    }).nullable(),
    body: completionPayloadSchema,
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
    }).defined(),
  }),
  async handler({ body }) {
    const botToken = getEnvVariable("STACK_TELEGRAM_BOT_TOKEN", "");
    const chatId = getEnvVariable("STACK_TELEGRAM_CHAT_ID", "");

    if (!botToken || !chatId) {
      throw new StackAssertionError("Telegram integration is not configured.");
    }

    const message = buildMessage(body);
    await postToTelegram({ botToken, chatId, message });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
      },
    };
  },
});

function buildMessage(payload: InferType<typeof completionPayloadSchema>): string {
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
    lines.push(`Stack: ${truncate(error.stack, STACK_TRACE_MAX_LENGTH)}`);
  }

  return `${MESSAGE_PREFIX}\n\n${lines.join("\n")}`;
}

async function postToTelegram({ botToken, chatId, message }: { botToken: string, chatId: string, message: string }): Promise<void> {
  const response = await fetch(`https://${TELEGRAM_HOSTNAME}/bot${botToken}${TELEGRAM_ENDPOINT_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
    }),
  });

  if (!response.ok) {
    const body = await safeReadBody(response);
    throw new StackAssertionError("Failed to send Telegram notification.", {
      status: response.status,
      body,
    });
  }
}

async function safeReadBody(response: Response): Promise<string | undefined> {
  try {
    return await response.text();
  } catch {
    return undefined;
  }
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
