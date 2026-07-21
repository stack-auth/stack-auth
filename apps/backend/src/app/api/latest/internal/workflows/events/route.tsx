import { customEventNameToWireType, enqueueWorkflowEvent } from "@/lib/workflows/events";
import { ensureWorkflowsEnabled } from "@/lib/workflows/gate";
import { globalPrismaClient } from "@/prisma-client";
import { WORKFLOW_EVENT_PAYLOAD_MAX_BYTES } from "@hexclave/shared/dist/interface/workflows";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, jsonSchema, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";
import { StatusError, throwErr } from "@hexclave/shared/dist/utils/errors";

export const POST = createSmartRouteHandler({
  metadata: { hidden: true },
  request: yupObject({
    // Server-or-admin: workflows.send() is available from inside workflows
    // (per-run server credentials) and from the admin app in v1.
    auth: yupObject({
      type: yupString().oneOf(["server", "admin"]).defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      name: yupString().defined(),
      data: jsonSchema.optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      event_id: yupString().defined(),
    }).defined(),
  }),
  async handler({ auth: { tenancy }, body }) {
    ensureWorkflowsEnabled(tenancy.project.id);

    const wireTypeResult = customEventNameToWireType(body.name);
    if ("error" in wireTypeResult) {
      throw new StatusError(400, wireTypeResult.error);
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(body.data ?? null), "utf8");
    if (payloadBytes > WORKFLOW_EVENT_PAYLOAD_MAX_BYTES) {
      throw new StatusError(400, `Event payload is ${payloadBytes} bytes, exceeding the ${WORKFLOW_EVENT_PAYLOAD_MAX_BYTES}-byte (256 KiB) limit. Store large payloads externally and send a reference.`);
    }

    const result = await enqueueWorkflowEvent(globalPrismaClient, {
      tenancy,
      type: wireTypeResult.wireType,
      payload: body.data ?? null,
    }) ?? throwErr("enqueueWorkflowEvent returned null after the gate and size checks passed — this should be impossible");

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        event_id: result.eventId,
      },
    };
  },
});
