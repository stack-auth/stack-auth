import { ensureClientCanAccessCustomer, getDefaultCardPaymentMethodSummary, getStripeCustomerForCustomerOrNull } from "@/lib/payments";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get payment method info",
    hidden: true,
    tags: ["Payments"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    params: yupObject({
      customer_type: yupString().oneOf(["user", "team"]).defined(),
      customer_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      has_customer: yupBoolean().defined(),
      default_payment_method: yupObject({
        id: yupString().defined(),
        brand: yupString().nullable().defined(),
        last4: yupString().nullable().defined(),
        exp_month: yupNumber().nullable().defined(),
        exp_year: yupNumber().nullable().defined(),
      }).nullable().defined(),
    }).defined(),
  }),
  handler: async ({ auth, params }, fullReq) => {
    if (auth.type === "client") {
      await ensureClientCanAccessCustomer({
        customerType: params.customer_type,
        customerId: params.customer_id,
        user: fullReq.auth?.user,
        tenancy: auth.tenancy,
        forbiddenMessage: "Clients can only manage their own billing.",
      });
    }

    const project = await globalPrismaClient.project.findUnique({
      where: { id: auth.tenancy.project.id },
      select: { stripeAccountId: true },
    });
    const stripeAccountId = project?.stripeAccountId;
    if (!stripeAccountId) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          has_customer: false,
          default_payment_method: null,
        },
      };
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const stripe = await getStripeForAccount({ accountId: stripeAccountId });
    const stripeCustomer = await getStripeCustomerForCustomerOrNull({
      stripe,
      prisma,
      tenancyId: auth.tenancy.id,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });

    if (!stripeCustomer) {
      return {
        statusCode: 200,
        bodyType: "json",
        body: {
          has_customer: false,
          default_payment_method: null,
        },
      };
    }

    const defaultPaymentMethod = await getDefaultCardPaymentMethodSummary({
      stripe,
      stripeCustomer,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        has_customer: true,
        default_payment_method: defaultPaymentMethod,
      },
    };
  },
});
