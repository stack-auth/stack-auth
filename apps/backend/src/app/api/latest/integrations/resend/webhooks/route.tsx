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

type ResendWebhookPayload = {
  type?: string,
  created_at?: string,
  data?: {
    // domain.* fields
    id?: string,
    status?: string,
    error?: string,
    // email.* fields
    email_id?: string,
    to?: string[] | string,
    created_at?: string,
    bounce?: {
      message?: string,
      subType?: string,
      type?: string,
    },
  },
};

// Window for matching a Resend webhook event back to an EmailOutbox row by (recipient, time).
// Generous because delivery info can take minutes; bounces can take up to ~72h.
const EVENT_MATCH_WINDOW_HOURS = 96;

type EmailEventKind = "delivered" | "delivery_delayed" | "bounced" | "complained";

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
  if (recipients.length === 0) {
    captureError("resend-webhook-email-event-missing-to", new StackAssertionError("Resend email.* webhook is missing data.to", { payload }));
    return;
  }

  const eventAt = parseEventTimestamp(payload.data?.created_at ?? payload.created_at);

  // Build the SET clause for this event kind. We only want to flip one of
  // (deliveredAt, deliveryDelayedAt, bouncedAt, markedAsSpamAt) — and only when
  // none of the terminal delivery states have been reached yet.
  const updateColumn =
    kind === "delivered" ? Prisma.sql`"deliveredAt"` :
      kind === "delivery_delayed" ? Prisma.sql`"deliveryDelayedAt"` :
        kind === "bounced" ? Prisma.sql`"bouncedAt"` :
          Prisma.sql`"markedAsSpamAt"`;

  // For `delivered` and `bounced` we don't want to overwrite a terminal state if we
  // somehow receive events out of order. `complained` records a separate user action
  // (markedAsSpamAt) that is meaningful even after delivery, so the terminal guard
  // doesn't apply — the typical Resend sequence is email.delivered → email.complained.
  const terminalGuard = kind === "complained"
    ? Prisma.sql`TRUE`
    : Prisma.sql`"deliveredAt" IS NULL AND "bouncedAt" IS NULL`;
  const selfGuard = kind === "delivered"
    ? Prisma.sql`"deliveredAt" IS NULL`
    : kind === "delivery_delayed"
      ? Prisma.sql`"deliveryDelayedAt" IS NULL`
      : kind === "bounced"
        ? Prisma.sql`"bouncedAt" IS NULL`
        : Prisma.sql`"markedAsSpamAt" IS NULL`;

  const windowStart = new Date(eventAt.getTime() - EVENT_MATCH_WINDOW_HOURS * 60 * 60 * 1000);

  for (const recipient of recipients) {
    const normalizedRecipient = recipient.trim().toLowerCase();
    if (normalizedRecipient.length === 0) continue;

    // Find the single most recent outbox row that matches this recipient and was sent within
    // the window. Match against either:
    //  - `to->emails` array (custom-emails / user-custom-emails with explicit emails), or
    //  - the user's primary email contact channel (user-primary-email,
    //    or user-custom-emails falling back to primary).
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
                WHERE LOWER(e.value) = ${normalizedRecipient}
              )
            )
            OR (
              o."to"->>'type' IN ('user-primary-email', 'user-custom-emails')
              AND EXISTS (
                SELECT 1 FROM "ContactChannel" cc
                WHERE cc."tenancyId" = o."tenancyId"
                  AND cc."projectUserId" = (o."to"->>'userId')::uuid
                  AND cc."type" = 'EMAIL'
                  AND LOWER(cc."value") = ${normalizedRecipient}
              )
            )
          )
        ORDER BY o."finishedSendingAt" DESC
        LIMIT 1
      )
      UPDATE "EmailOutbox" e
      SET ${updateColumn} = ${eventAt},
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
        recipient: normalizedRecipient,
        eventAt: eventAt.toISOString(),
        emailId: payload.data?.email_id,
      }));
    }
  }
}

function parseEventTimestamp(raw: string | undefined): Date {
  if (raw) {
    const parsed = new Date(raw);
    if (!isNaN(parsed.getTime())) return parsed;
    captureError("resend-webhook-parse-event-timestamp-invalid", new StackAssertionError("parseEventTimestamp: failed to parse raw timestamp, falling back to current time", { raw }));
  }
  return new Date();
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

    const payloadResult = Result.fromThrowing(() => JSON.parse(decodeBody(fullReq.bodyBuffer)) as ResendWebhookPayload);
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
