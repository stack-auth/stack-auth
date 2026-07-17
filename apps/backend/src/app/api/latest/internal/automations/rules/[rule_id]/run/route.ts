import { createSendEmailActionAdapter } from "@/lib/automations/actions/send-email";
import { createPrismaAutomationRuleExecutionStateStore } from "@/lib/automations/execution-state-store";
import {
  automationRunResultToApiBody,
  getSingleAutomationEmailSendResult,
  runAutomationRuleForManualRoute,
} from "@/lib/automations/run-route";
import { parseAutomationScheduledAtMillis } from "@/lib/automations/scheduled-at";
import {
  createPaymentsItemQuotaSourceAdapter,
  paymentsItemQuotaCustomerDataReaders,
  prismaPaymentsItemQuotaProjectUserReader,
} from "@/lib/automations/sources/payments-item-quota";
import { sendEmailToMany } from "@/lib/emails";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    auth: yupObject({
      type: serverOrHigherAuthTypeSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      rule_id: yupString().defined(),
    }).defined(),
    body: yupObject({
      limit: yupNumber().integer().min(1).max(1000).optional(),
      cursor: yupString().nullable().optional(),
      scheduled_at_millis: yupNumber().integer().optional(),
    }).optional().default({}),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      rule_id: yupString().defined(),
      mode: yupString().oneOf(["run"]).defined(),
      evaluated_count: yupNumber().integer().defined(),
      eligible_count: yupNumber().integer().defined(),
      suppressed_count: yupNumber().integer().defined(),
      sent_count: yupNumber().integer().defined(),
      next_cursor: yupString().nullable().defined(),
      decisions: yupArray(yupObject({
        subject_type: yupString().oneOf(["user"]).defined(),
        subject_id: yupString().defined(),
        signal_key: yupString().defined(),
        sent: yupBoolean().defined(),
        source: yupObject({
          type: yupString().oneOf(["payments-item-quota"]).defined(),
          item_id: yupString().defined(),
          current_quantity: yupNumber().defined(),
          entitlement_quantity: yupNumber().nullable().defined(),
          threshold_kind: yupString().oneOf(["near", "over"]).defined(),
          owned_product_ids: yupArray(yupString().defined()).defined(),
          active_subscription_ids: yupArray(yupString().defined()).defined(),
        }).defined(),
        action: yupObject({
          type: yupString().oneOf(["send-email"]).defined(),
          template_id: yupString().defined(),
          notification_category_name: yupString().oneOf(["Marketing"]).defined(),
        }).defined(),
        cooldown: yupObject({
          blocked: yupBoolean().defined(),
          last_action_at_millis: yupNumber().optional(),
          next_eligible_at_millis: yupNumber().optional(),
        }).defined(),
        skip_reason: yupString().oneOf(["cooldown"]).optional(),
      })).defined(),
    }).defined(),
  }),
  async handler({ auth, params, body }) {
    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const sourceAdapter = createPaymentsItemQuotaSourceAdapter({
      prisma,
      projectUserReader: prismaPaymentsItemQuotaProjectUserReader,
      customerDataReaders: paymentsItemQuotaCustomerDataReaders,
    });
    const scheduledAt = parseAutomationScheduledAtMillis(body.scheduled_at_millis, "scheduled_at_millis");
    const result = await runAutomationRuleForManualRoute({
      tenancy: auth.tenancy,
      ruleId: params.rule_id,
      limit: body.limit,
      cursor: body.cursor,
      scheduledAt,
      now: new Date(),
      sourceAdapter,
      actionAdapter: createSendEmailActionAdapter(),
      stateStore: createPrismaAutomationRuleExecutionStateStore(prisma),
      emailSender: async ({ action, scheduledAt, emailOutboxId }) => {
        const enqueueResult = await sendEmailToMany({
          tenancy: auth.tenancy,
          recipients: [action.recipient],
          tsxSource: action.tsxSource,
          extraVariables: action.variables,
          themeId: action.themeId ?? null,
          isHighPriority: action.isHighPriority,
          shouldSkipDeliverabilityCheck: action.shouldSkipDeliverabilityCheck,
          scheduledAt,
          createdWith: action.createdWith,
          overrideSubject: action.subject,
          overrideNotificationCategoryId: action.notificationCategoryId,
          emailOutboxIds: [emailOutboxId],
        });
        return getSingleAutomationEmailSendResult(enqueueResult);
      },
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: automationRunResultToApiBody(result),
    };
  },
});
