import { processResendDomainWebhookEvent } from "@/lib/managed-email-onboarding";
import { globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { Prisma } from "@/generated/prisma/client";
import { yupBoolean, yupMixed, yupNumber, yupObject, yupString, yupTuple } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { captureError, StackAssertionError, StatusError } from "@stackframe/stack-shared/dist/utils/errors";
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

const resendWebhookRecipientSchema = yupMixed<string | string[]>()
  .test(
    "string-or-string-array",
    "data.to must be a string or an array of strings",
    (value) => value == null || typeof value === "string" || (Array.isArray(value) && value.every((recipient) => typeof recipient === "string")),
  )
  .optional();

const resendWebhookPayloadSchema = yupObject({
  type: yupString().optional(),
  created_at: yupString().optional(),
  data: yupObject({
    // domain.* fields
    id: yupString().optional(),
    status: yupString().optional(),
    error: yupString().optional(),
    // email.* fields
    email_id: yupString().optional(),
    to: resendWebhookRecipientSchema,
    created_at: yupString().optional(),
    bounce: yupObject({
      message: yupString().optional(),
      subType: yupString().optional(),
      type: yupString().optional(),
    }).optional(),
  }).optional(),
}).defined();

type ResendWebhookPayload = Awaited<ReturnType<typeof parseResendWebhookPayload>>;

async function parseResendWebhookPayload(bodyBuffer: ArrayBuffer) {
  const payload = JSON.parse(decodeBody(bodyBuffer));
  return await resendWebhookPayloadSchema.validate(payload, {
    strict: true,
    stripUnknown: false,
  });
}

type EmailEventKind = "delivered" | "delivery_delayed" | "bounced" | "complained";

// Windows for matching a Resend webhook event back to an EmailOutbox row by
// (recipient, time). Delivery and bounce signals are usually close to sending;
// spam complaints can arrive much later when a recipient revisits their inbox.
const EVENT_MATCH_WINDOW_HOURS_BY_KIND = {
  delivered: 96,
  delivery_delayed: 96,
  bounced: 96,
  complained: 24 * 30,
} satisfies Record<EmailEventKind, number>;

function emailEventKindFromType(type: string): EmailEventKind | null {
  switch (type) {
    case "email.delivered": {
      return "delivered";
    }
    case "email.delivery_delayed": {
      return "delivery_delayed";
    }
    case "email.bounced": {
      return "bounced";
    }
    case "email.complained": {
      return "complained";
    }
    default: {
      return null;
    }
  }
}

async function processEmailDeliveryEvent(kind: EmailEventKind, payload: ResendWebhookPayload): Promise<void> {
  const rawTo = payload.data?.to;
  const recipients = Array.isArray(rawTo) ? rawTo : (typeof rawTo === "string" ? [rawTo] : []);
  const normalizedRecipients = [...new Set(
    recipients
      .map((recipient) => recipient.trim().toLowerCase())
      .filter((recipient) => recipient.length > 0),
  )];
  if (normalizedRecipients.length === 0) {
    captureError("resend-webhook-email-event-missing-to", new StackAssertionError("Resend email.* webhook is missing data.to", { payload }));
    return;
  }

  const eventAt = parseEventTimestamp(payload.data?.created_at ?? payload.created_at);
  if (eventAt == null) {
    captureError("resend-webhook-email-event-missing-created-at", new StackAssertionError("Resend email.* webhook has missing or invalid created_at; skipping delivery-state update", {
      kind,
      rawCreatedAt: payload.data?.created_at ?? payload.created_at,
      emailId: payload.data?.email_id,
    }));
    return;
  }

  // Build the delivery-state SET clause for this event kind. `delivery_delayed`
  // is non-terminal; Resend can later send `delivered` or `bounced`, and the
  // EmailOutbox exclusivity constraint allows only one of delivered/delayed/bounced.
  const deliveryUpdate =
    kind === "delivered" ? Prisma.sql`"deliveredAt" = ${eventAt}, "deliveryDelayedAt" = NULL` :
      kind === "delivery_delayed" ? Prisma.sql`"deliveryDelayedAt" = ${eventAt}` :
        kind === "bounced" ? Prisma.sql`"bouncedAt" = ${eventAt}, "deliveryDelayedAt" = NULL` :
          Prisma.sql`"markedAsSpamAt" = ${eventAt}`;

  // For `delivered` and `delivery_delayed` we don't want to overwrite a terminal
  // delivery state if we somehow receive events out of order. `bounced` and
  // `complained` are meaningful even after delivery; Resend can send
  // email.delivered before an async bounce, and users can mark delivered email as spam.
  const terminalGuard = kind === "complained" || kind === "bounced"
    ? Prisma.sql`TRUE`
    : Prisma.sql`"deliveredAt" IS NULL AND "bouncedAt" IS NULL`;
  const selfGuard = kind === "delivered"
    ? Prisma.sql`"deliveredAt" IS NULL`
    : kind === "delivery_delayed"
      ? Prisma.sql`"deliveryDelayedAt" IS NULL`
      : kind === "bounced"
        ? Prisma.sql`"bouncedAt" IS NULL`
        : Prisma.sql`"markedAsSpamAt" IS NULL`;

  const eventMatchWindowHours = EVENT_MATCH_WINDOW_HOURS_BY_KIND[kind];
  const windowStart = new Date(eventAt.getTime() - eventMatchWindowHours * 60 * 60 * 1000);

  // Find the single most recent outbox row that matches any recipient and was sent within
  // the window. Match against either:
  //  - `to->emails` array (custom-emails / user-custom-emails with explicit emails), or
  //  - the user's primary email contact channel (user-primary-email,
  //    or user-custom-emails falling back to primary).
  // Resend's email_id is not stored in EmailOutbox today, so when multiple emails
  // to the same recipient land inside the match window, this intentionally chooses
  // the latest one sent no later than the event timestamp.
  // We CTE-select the single best candidate then conditionally UPDATE it.
  const updated = await globalPrismaClient.$queryRaw<{ id: string, tenancyId: string }[]>(Prisma.sql`
    WITH candidate AS (
      SELECT o."tenancyId", o."id"
      FROM "EmailOutbox" o
      WHERE o."canHaveDeliveryInfo" = TRUE
        AND o."finishedSendingAt" IS NOT NULL
        AND o."finishedSendingAt" >= ${windowStart}
        AND o."finishedSendingAt" <= ${eventAt}
        AND ${terminalGuard}
        AND ${selfGuard}
        AND (
          (
            o."to"->>'type' IN ('custom-emails', 'user-custom-emails')
            AND EXISTS (
              SELECT 1
              FROM jsonb_array_elements_text(COALESCE(o."to"->'emails', '[]'::jsonb)) AS e(value)
              WHERE LOWER(e.value) IN (${Prisma.join(normalizedRecipients)})
            )
          )
          OR (
            o."to"->>'type' IN ('user-primary-email', 'user-custom-emails')
            AND EXISTS (
              SELECT 1 FROM "ContactChannel" cc
              WHERE cc."tenancyId" = o."tenancyId"
                AND cc."projectUserId" = (o."to"->>'userId')::uuid
                AND cc."type" = 'EMAIL'
                AND LOWER(cc."value") IN (${Prisma.join(normalizedRecipients)})
            )
          )
        )
      ORDER BY o."finishedSendingAt" DESC
      LIMIT 1
    )
    UPDATE "EmailOutbox" e
    SET ${deliveryUpdate},
        "shouldUpdateSequenceId" = TRUE
    FROM candidate
    WHERE e."tenancyId" = candidate."tenancyId"
      AND e."id" = candidate."id"
      AND ${terminalGuard}
      AND ${selfGuard}
    RETURNING e."id", e."tenancyId";
  `);

  if (updated.length === 0) {
    // Not fatal — could be a test email, an already-final row, or an event outside our match window.
    captureError("resend-webhook-email-event-no-match", new StackAssertionError("No EmailOutbox row matched Resend webhook event", {
      kind,
      recipients: normalizedRecipients,
      eventAt: eventAt.toISOString(),
      emailId: payload.data?.email_id,
    }));
  }
}

function parseEventTimestamp(raw: string | undefined): Date | null {
  if (raw == null) {
    return null;
  }
  if (raw.length > 0) {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  captureError("resend-webhook-parse-event-timestamp-invalid", new StackAssertionError("parseEventTimestamp: failed to parse raw timestamp", { raw }));
  return null;
}

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

    const payloadResult = await Result.fromThrowingAsync(async () => await parseResendWebhookPayload(fullReq.bodyBuffer));
    if (payloadResult.status === "error") {
      throw new StatusError(400, "Invalid JSON payload in Resend webhook");
    }
    const payload = payloadResult.data;
    const eventType = payload.type;

    if (eventType === "domain.updated") {
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
    } else {
      const kind = eventType ? emailEventKindFromType(eventType) : null;
      if (kind) {
        await processEmailDeliveryEvent(kind, payload);
      } else {
        captureError("resend-webhook-unknown-event-type", new StackAssertionError("Resend webhook payload has unknown event type", {
          eventType,
          payload,
        }));
      }
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        received: true,
      },
    };
  },
});
