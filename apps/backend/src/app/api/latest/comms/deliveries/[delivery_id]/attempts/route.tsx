import { recordAttempt } from "@/lib/comms/deliveries";
import { getPrismaClientForTenancy, retryTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import {
  commsDeliveryAttemptCreateSchema,
  commsDeliveryAttemptSchema,
  commsDeliverySchema,
} from "@hexclave/shared/dist/interface/comms";
import {
  adaptSchema,
  serverOrHigherAuthTypeSchema,
  yupNumber,
  yupObject,
  yupString,
} from "@hexclave/shared/dist/schema-fields";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { Prisma } from "@/generated/prisma/client";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Record delivery attempt",
    description: "Appends an immutable delivery attempt and optionally advances delivery status.",
    tags: ["Comms"],
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema,
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      delivery_id: yupString().uuid().defined(),
    }).defined(),
    body: commsDeliveryAttemptCreateSchema,
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([201]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      delivery: commsDeliverySchema,
      attempt: commsDeliveryAttemptSchema,
    }).defined(),
  }),
  handler: async ({ auth, params, body }) => {
    const finishedAt = body.finished_at_millis === undefined
      ? undefined
      : body.finished_at_millis === null
        ? null
        : new Date(body.finished_at_millis);
    if (finishedAt instanceof Date && Number.isNaN(finishedAt.getTime())) {
      throw new StatusError(StatusError.BadRequest, "finished_at_millis is outside the supported date range");
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const result = await retryTransaction(prisma, async (tx) => {
      return await recordAttempt(tx, {
        tenancyId: auth.tenancy.id,
        deliveryId: params.delivery_id,
        outcome: body.outcome,
        providerResponse: body.provider_response === undefined
          ? undefined
          : body.provider_response === null
            ? null
            : body.provider_response as Prisma.InputJsonValue,
        errorPublic: body.error_public,
        errorInternal: body.error_internal,
        finishedAt,
        status: body.status,
        providerMessageId: body.provider_message_id,
      });
    });
    return {
      statusCode: 201 as const,
      bodyType: "json" as const,
      body: result,
    };
  },
});
