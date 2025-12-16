import { ensureStripeCustomerForCustomer, getDefaultCardPaymentMethodSummary } from "@/lib/payments";
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
      throw new StatusError(StatusError.Forbidden, "Clients can only manage their own payment method.");
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

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Set default payment method from a setup intent",
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
    body: yupObject({
      setup_intent_id: yupString().defined(),
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
      default_payment_method: yupObject({
        id: yupString().defined(),
        brand: yupString().nullable().defined(),
        last4: yupString().nullable().defined(),
        exp_month: yupNumber().nullable().defined(),
        exp_year: yupNumber().nullable().defined(),
      }).nullable().defined(),
    }).defined(),
  }),
  handler: async ({ auth, params, body }, fullReq) => {
    if (auth.type === "client") {
      await ensureClientCanAccessCustomer(
        { customer_type: params.customer_type, customer_id: params.customer_id },
        fullReq,
        auth.tenancy,
      );
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const stripe = await getStripeForAccount({ tenancy: auth.tenancy });
    const stripeCustomer = await ensureStripeCustomerForCustomer({
      stripe,
      prisma,
      tenancyId: auth.tenancy.id,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });

    const setupIntent = await stripe.setupIntents.retrieve(body.setup_intent_id);
    if (setupIntent.customer !== stripeCustomer.id) {
      throw new StatusError(StatusError.Forbidden, "Setup intent does not belong to this customer.");
    }
    if (setupIntent.status !== "succeeded") {
      throw new StatusError(400, "Setup intent has not succeeded.");
    }
    if (!setupIntent.payment_method || typeof setupIntent.payment_method !== "string") {
      throw new StatusError(500, "Setup intent missing payment method.");
    }

    await stripe.customers.update(stripeCustomer.id, {
      invoice_settings: {
        default_payment_method: setupIntent.payment_method,
      },
    });

    const updatedCustomer = await stripe.customers.retrieve(stripeCustomer.id);
    if (updatedCustomer.deleted) {
      throw new StatusError(500, "Stripe customer was deleted unexpectedly.");
    }

    const summary = await getDefaultCardPaymentMethodSummary({
      stripe,
      stripeCustomer: updatedCustomer,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        success: true,
        default_payment_method: summary,
      },
    };
  },
});

