import { processResendDomainWebhookEvent } from "@/lib/managed-email-onboarding";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { Result } from "@stackframe/stack-shared/dist/utils/results";
import { Webhook } from "svix";

function decodeBody(bodyBuffer: ArrayBuffer) {
  return new TextDecoder().decode(bodyBuffer);
}

function ensureResendWebhookSignature(headers: Record<string, string[] | undefined>, bodyBuffer: ArrayBuffer) {
  const webhookSecret = getEnvVariable("STACK_RESEND_WEBHOOK_SECRET");
  const svixId = headers["svix-id"]?.[0] ?? null;
  const svixTimestamp = headers["svix-timestamp"]?.[0] ?? null;
  const svixSignature = headers["svix-signature"]?.[0] ?? null;
  if (svixId == null || svixTimestamp == null || svixSignature == null) {
    throw new StatusError(400, "Missing Svix signature headers for Resend webhook");
  }

  const verifier = new Webhook(webhookSecret);
  const result = Result.fromThrowing(() => verifier.verify(decodeBody(bodyBuffer), {
    "svix-id": svixId,
    "svix-timestamp": svixTimestamp,
    "svix-signature": svixSignature,
  }));
  if (result.status === "error") {
    throw new StatusError(400, "Invalid Resend webhook signature");
  }
}

type ResendDomainWebhookPayload = {
  type?: string,
  data?: {
    id?: string,
    status?: string,
    error?: string,
  },
};

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

    const payloadResult = Result.fromThrowing(() => JSON.parse(decodeBody(fullReq.bodyBuffer)) as ResendDomainWebhookPayload);
    if (payloadResult.status === "error") {
      throw new StatusError(400, "Invalid JSON payload in Resend webhook");
    }
    if (payloadResult.data.type !== "domain.updated") {
      return {
        statusCode: 200,
        bodyType: "json",
        body: { received: true },
      };
    }
    const payload = payloadResult.data;

    const domainId = payload.data?.id;
    const providerStatusRaw = payload.data?.status;
    if (domainId == null || providerStatusRaw == null) {
      throw new StackAssertionError("Resend webhook payload missing required domain fields", {
        payload,
      });
    }

    await processResendDomainWebhookEvent({
      domainId,
      providerStatusRaw,
      errorMessage: payload.data?.error,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        received: true,
      },
    };
  },
});
