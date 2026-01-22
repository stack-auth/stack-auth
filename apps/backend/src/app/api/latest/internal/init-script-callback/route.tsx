import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { getTelegramConfig, sendTelegramMessage } from "@/lib/telegram";
import { adaptSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { InferType } from "yup";
import { throwErr } from "@stackframe/stack-shared/dist/utils/errors";

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
  metadata: {
    hidden: true,
  },
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
    const { botToken, chatId } = getTelegramConfig("init-stack") ?? throwErr("Telegram integration is not configured.");
    const message = buildMessage(body);
    await sendTelegramMessage({ botToken, chatId, message });

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
