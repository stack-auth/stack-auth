import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";

const TELEGRAM_HOSTNAME = "api.telegram.org";
const TELEGRAM_ENDPOINT_PATH = "/sendMessage";

export const POST = createSmartRouteHandler({
  request: yupObject({
    auth: yupObject({
      type: adaptSchema,
      user: adaptSchema,
      project: adaptSchema,
    }).nullable(),
    body: yupObject({
      message: yupString().min(1).max(4096).defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
    }).defined(),
  }),
  async handler({ body: { message } }) {
    const botToken = getEnvVariable("STACK_INIT_TELEGRAM_BOT_TOKEN", "");
    const chatId = getEnvVariable("STACK_INIT_TELEGRAM_CHAT_ID", "");

    if (!botToken || !chatId) {
      throw new Error("Telegram integration is not configured.");
    }

    await fetch(`https://${TELEGRAM_HOSTNAME}/bot${botToken}${TELEGRAM_ENDPOINT_PATH}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
      },
    };
  },
});
