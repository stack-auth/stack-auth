import { ensureStripeCustomerForCustomer } from "@/lib/payments";
import { ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
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
    summary: "Create a setup intent to update default payment method",
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
    body: yupObject({}).default(() => ({})).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      client_secret: yupString().defined(),
      stripe_account_id: yupString().defined(),
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
    const stripeCustomer = await ensureStripeCustomerForCustomer({
      stripe,
      prisma,
      tenancyId: auth.tenancy.id,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });

    const setupIntent = await stripe.setupIntents.create({
      customer: stripeCustomer.id,
      usage: "off_session",
      payment_method_types: ["card"],
    });
    if (!setupIntent.client_secret) {
      throw new StatusError(500, "No client secret returned from Stripe.");
    }

    const project = await globalPrismaClient.project.findUnique({
      where: { id: auth.tenancy.project.id },
      select: { stripeAccountId: true },
    });
    const stripeAccountId = project?.stripeAccountId;
    if (!stripeAccountId) {
      throw new StatusError(400, "Payments are not set up in this Stack Auth project.");
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        client_secret: setupIntent.client_secret,
        stripe_account_id: stripeAccountId,
      },
    };
  },
});

