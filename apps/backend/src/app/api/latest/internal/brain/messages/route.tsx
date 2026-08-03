import { isBrainEnabled, postHumanBrainMessage } from "@/lib/brain";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  adaptSchema,
  adminAuthTypeSchema,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Post a human message to the Brain",
    description: "Appends a user message to the singleton Brain conversation and schedules a turn.",
    tags: ["Brain"],
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: adminAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      text: yupString().min(1).max(32_000).defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      message_id: yupString().uuid().defined(),
    }).defined(),
  }),
  async handler({ auth, body }) {
    if (!isBrainEnabled(auth.tenancy)) {
      throw new StatusError(StatusError.Forbidden, "Brain is not enabled for this project. Install the Brain app to use it.");
    }

    const result = await postHumanBrainMessage({
      tenancy: auth.tenancy,
      text: body.text,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        message_id: result.messageId,
      },
    };
  },
});
