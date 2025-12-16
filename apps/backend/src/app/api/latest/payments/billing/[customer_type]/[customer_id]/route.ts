import { getDefaultCardPaymentMethodSummary, getStripeCustomerForCustomerOrNull } from "@/lib/payments";
import { ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";

async function ensureClientCanAccessCustomer(params: { customer_type: "user" | "team", customer_id: string }, fullReq: any, tenancy: any) {
  const currentUser = fullReq.auth?.user;
  if (!currentUser) {
    throw new KnownErrors.UserAuthenticationRequired();
  }
  if (params.customer_type === "user") {
    if (params.customer_id !== currentUser.id) {
      throw new StatusError(StatusError.Forbidden, "Clients can only manage their own billing.");
    }
    return;
  }

  const prisma = await getPrismaClientForTenancy(tenancy);
  await ensureUserTeamPermissionExists(prisma, {
    tenancy,
    teamId: params.customer_id,
    userId: currentUser.id,
    permissionId: "team_admin",
    errorType: "required",
    recursive: true,
  });
}

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
      await ensureClientCanAccessCustomer(
        { customer_type: params.customer_type, customer_id: params.customer_id },
        fullReq,
        auth.tenancy,
      );
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const stripe = await getStripeForAccount({ tenancy: auth.tenancy });
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
