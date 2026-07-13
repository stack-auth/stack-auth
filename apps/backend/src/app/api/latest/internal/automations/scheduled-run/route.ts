import {
  normalizeScheduledAutomationRunPageLimit,
  runScheduledAutomationRulePage,
} from "@/lib/automations/scheduler";
import { parseAutomationScheduledAtMillis } from "@/lib/automations/scheduled-at";
import { ensureUpstashSignature } from "@/lib/upstash";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { yupBoolean, yupNumber, yupObject, yupString, yupTuple } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Run one scheduled automation rule page",
    description: "Receives QStash work for a single tenancy/rule automation run page.",
    tags: ["Automations"],
    hidden: true,
  },
  request: yupObject({
    headers: yupObject({
      "upstash-signature": yupTuple([yupString().defined()]).defined(),
    }).defined(),
    method: yupString().oneOf(["POST"]).defined(),
    body: yupObject({
      tenancyId: yupString().defined(),
      ruleId: yupString().defined(),
      cursor: yupString().nullable().optional(),
      limit: yupNumber().integer().min(1).max(100).optional(),
      scheduledAtMillis: yupNumber().integer().optional(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      ok: yupBoolean().defined(),
      status: yupString().oneOf(["ran", "skipped"]).defined(),
      skipped_reason: yupString().oneOf(["tenancy-not-found", "rule-not-found", "rule-disabled"]).optional(),
      evaluated_count: yupNumber().integer().optional(),
      sent_count: yupNumber().integer().optional(),
      suppressed_count: yupNumber().integer().optional(),
      next_cursor: yupString().nullable().optional(),
      enqueued_continuation: yupBoolean().optional(),
    }).defined(),
  }),
  handler: async ({ body }, fullReq) => {
    await ensureUpstashSignature(fullReq);
    const scheduledAt = parseAutomationScheduledAtMillis(body.scheduledAtMillis, "scheduledAtMillis");
    const result = await runScheduledAutomationRulePage({
      tenancyId: body.tenancyId,
      ruleId: body.ruleId,
      cursor: body.cursor,
      limit: normalizeScheduledAutomationRunPageLimit(body.limit),
      scheduledAt,
      now: new Date(),
    });

    if (result.status === "skipped") {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          ok: true,
          status: result.status,
          skipped_reason: result.reason,
        },
      };
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        ok: true,
        status: result.status,
        evaluated_count: result.result.evaluatedCount,
        sent_count: result.result.sentCount,
        suppressed_count: result.result.suppressedCount,
        next_cursor: result.result.nextCursor,
        enqueued_continuation: result.enqueuedContinuation,
      },
    };
  },
});
