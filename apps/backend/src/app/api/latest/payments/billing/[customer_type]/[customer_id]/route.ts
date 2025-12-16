import { ensureStripeCustomerForCustomer, getDefaultCardPaymentMethodSummary, getStripeCustomerForCustomerOrNull } from "@/lib/payments";
import { ensureUserTeamPermissionExists } from "@/lib/request-checks";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
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

const addressSchema = yupObject({
  line1: yupString().optional().default(undefined),
  line2: yupString().optional().default(undefined),
  city: yupString().optional().default(undefined),
  state: yupString().optional().default(undefined),
  postal_code: yupString().optional().default(undefined),
  country: yupString().optional().default(undefined),
}).optional().default(undefined);

export const GET = createSmartRouteHandler({
  metadata: {
    summary: "Get billing info and default payment method",
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
      billing_details: yupObject({
        name: yupString().nullable().defined(),
        email: yupString().nullable().defined(),
        phone: yupString().nullable().defined(),
        address: yupObject({
          line1: yupString().nullable().defined(),
          line2: yupString().nullable().defined(),
          city: yupString().nullable().defined(),
          state: yupString().nullable().defined(),
          postal_code: yupString().nullable().defined(),
          country: yupString().nullable().defined(),
        }).nullable().defined(),
      }).defined(),
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
          billing_details: {
            name: null,
            email: null,
            phone: null,
            address: null,
          },
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
        billing_details: {
          name: stripeCustomer.name ?? null,
          email: stripeCustomer.email ?? null,
          phone: stripeCustomer.phone ?? null,
          address: stripeCustomer.address ? {
            line1: stripeCustomer.address.line1 ?? null,
            line2: stripeCustomer.address.line2 ?? null,
            city: stripeCustomer.address.city ?? null,
            state: stripeCustomer.address.state ?? null,
            postal_code: stripeCustomer.address.postal_code ?? null,
            country: stripeCustomer.address.country ?? null,
          } : null,
        },
        default_payment_method: defaultPaymentMethod,
      },
    };
  },
});

export const POST = createSmartRouteHandler({
  metadata: {
    summary: "Update billing info",
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
      name: yupString().optional().default(undefined),
      email: yupString().optional().default(undefined),
      phone: yupString().optional().default(undefined),
      address: addressSchema,
    }).defined(),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      success: yupBoolean().oneOf([true]).defined(),
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

    const project = await globalPrismaClient.project.findUnique({
      where: { id: auth.tenancy.project.id },
      select: { stripeAccountId: true },
    });
    if (!project?.stripeAccountId) {
      throw new StatusError(400, "Payments are not set up in this Stack Auth project.");
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

    const shouldUpdate =
      body.name !== undefined ||
      body.email !== undefined ||
      body.phone !== undefined ||
      body.address !== undefined;
    if (!shouldUpdate) {
      throw new StatusError(400, "No billing fields provided.");
    }

    await stripe.customers.update(stripeCustomer.id, {
      name: body.name,
      email: body.email,
      phone: body.phone,
      address: body.address,
    });

    return {
      statusCode: 200,
      bodyType: "json",
      body: { success: true },
    };
  },
});

