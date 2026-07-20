import { createSendEmailActionAdapter } from "@/lib/automations/actions/send-email";
import {
  AutomationDryRunRecipientStatusReader,
  evaluateAutomationRuleDryRunForRoute,
} from "@/lib/automations/dry-run-route";
import { createPrismaAutomationRuleExecutionStateReader } from "@/lib/automations/execution-state-store";
import {
  createPaymentsItemQuotaSourceAdapter,
  paymentsItemQuotaCustomerDataReaders,
  prismaPaymentsItemQuotaProjectUserReader,
} from "@/lib/automations/sources/payments-item-quota";
import { getPrismaClientForTenancy, PrismaClientTransaction } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, serverOrHigherAuthTypeSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@hexclave/shared/dist/schema-fields";

export const prismaAutomationDryRunRecipientStatusReader: AutomationDryRunRecipientStatusReader<PrismaClientTransaction> = async (options) => {
  const users = await options.prisma.projectUser.findMany({
    where: {
      tenancyId: options.tenancyId,
      projectUserId: {
        in: options.userIds,
      },
    },
    select: {
      projectUserId: true,
      contactChannels: {
        where: {
          type: "EMAIL",
          isPrimary: "TRUE",
        },
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  return new Map(users.map((user) => [user.projectUserId, {
    userExists: true,
    hasPrimaryEmail: user.contactChannels.length > 0,
  }]));
};

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
    }).optional().default({}),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      rule_id: yupString().defined(),
      mode: yupString().oneOf(["dry-run"]).defined(),
      evaluated_count: yupNumber().integer().defined(),
      eligible_count: yupNumber().integer().defined(),
      suppressed_count: yupNumber().integer().defined(),
      next_cursor: yupString().nullable().defined(),
      decisions: yupArray(yupObject({
        subject_type: yupString().oneOf(["user"]).defined(),
        subject_id: yupString().defined(),
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
        recipient: yupObject({
          user_exists: yupBoolean().defined(),
          has_primary_email: yupBoolean().defined(),
        }).defined(),
        skip_reason: yupString().oneOf(["cooldown", "in-flight", "retry-backoff"]).optional(),
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
    return {
      statusCode: 200,
      bodyType: "json",
      body: await evaluateAutomationRuleDryRunForRoute({
        tenancy: auth.tenancy,
        ruleId: params.rule_id,
        limit: body.limit,
        cursor: body.cursor,
        prisma,
        sourceAdapter,
        actionAdapter: createSendEmailActionAdapter(),
        recipientStatusReader: prismaAutomationDryRunRecipientStatusReader,
        executionStateReader: createPrismaAutomationRuleExecutionStateReader(prisma),
        now: new Date(),
      }),
    };
  },
});
