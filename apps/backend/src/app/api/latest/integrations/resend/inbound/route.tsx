import { parseInboundResendPayload, processInboundEmail } from "@/lib/inbound-email";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";
import { getEnvVariable } from "@hexclave/shared/dist/utils/env";
import { StatusError } from "@hexclave/shared/dist/utils/errors";
import { Result } from "@hexclave/shared/dist/utils/results";
import { Webhook } from "svix";

function decodeBody(bodyBuffer: ArrayBuffer) {
  return new TextDecoder().decode(bodyBuffer);
}

// The inbound webhook may be signed with its own secret; fall back to the shared
// Resend webhook secret so operators only have to configure one.
function getInboundWebhookSecret(): string {
  return getEnvVariable("STACK_RESEND_INBOUND_WEBHOOK_SECRET", "") || getEnvVariable("STACK_RESEND_WEBHOOK_SECRET");
}

function ensureResendWebhookSignature(headers: Record<string, string[] | undefined>, bodyBuffer: ArrayBuffer) {
  const webhookSecret = getInboundWebhookSecret();
  const svixId = headers["svix-id"]?.[0] ?? null;
  const svixTimestamp = headers["svix-timestamp"]?.[0] ?? null;
  const svixSignature = headers["svix-signature"]?.[0] ?? null;
  if (svixId == null || svixTimestamp == null || svixSignature == null) {
    throw new StatusError(400, "Missing Svix signature headers for Resend inbound webhook");
  }

  const verifier = new Webhook(webhookSecret);
  const result = Result.fromThrowing(() => verifier.verify(decodeBody(bodyBuffer), {
    "svix-id": svixId,
    "svix-timestamp": svixTimestamp,
    "svix-signature": svixSignature,
  }));
  if (result.status === "error") {
    throw new StatusError(400, "Invalid Resend inbound webhook signature");
  }
}

// Resend's inbound-email event type. Kept as a constant so unknown event types
// are acknowledged (200) without processing, which prevents webhook retries.
const INBOUND_EVENT_TYPES = new Set(["email.received", "inbound.email.received", "email.inbound"]);

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    headers: yupObject({
      "svix-id": yupTuple([yupString().defined()]).defined(),
      "svix-timestamp": yupTuple([yupString().defined()]).defined(),
      "svix-signature": yupTuple([yupString().defined()]).defined(),
    }).defined(),
    body: yupMixed().optional(),
    method: yupString().oneOf(["POST"]).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      received: yupBoolean().defined(),
    }).defined(),
  }),
  handler: async (req, fullReq) => {
    ensureResendWebhookSignature(req.headers, fullReq.bodyBuffer);

    const payloadResult = Result.fromThrowing(() => JSON.parse(decodeBody(fullReq.bodyBuffer)) as { type?: unknown });
    if (payloadResult.status === "error") {
      throw new StatusError(400, "Invalid JSON payload in Resend inbound webhook");
    }
    const payload = payloadResult.data;

    const eventType = typeof payload.type === "string" ? payload.type : "";
    if (!INBOUND_EVENT_TYPES.has(eventType)) {
      return { statusCode: 200, bodyType: "json", body: { received: true } };
    }

    const parsed = parseInboundResendPayload(payload);
    if (parsed != null) {
      // Ignored results (no matching support address) are expected and acknowledged.
      await processInboundEmail(parsed);
    }

    return { statusCode: 200, bodyType: "json", body: { received: true } };
  },
});
