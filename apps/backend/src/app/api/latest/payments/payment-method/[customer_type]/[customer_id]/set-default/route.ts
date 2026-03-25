import { ensureClientCanAccessCustomer, ensureStripeCustomerForCustomer, getDefaultCardPaymentMethodSummary } from "@/lib/payments";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { adaptSchema, clientOrHigherAuthTypeSchema, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError } from "@stackframe/stack-shared/dist/utils/errors";
import { typedToUppercase } from "@stackframe/stack-shared/dist/utils/strings";

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
      await ensureClientCanAccessCustomer({
        customerType: params.customer_type,
        customerId: params.customer_id,
        user: fullReq.auth?.user,
        tenancy: auth.tenancy,
        forbiddenMessage: "Clients can only manage their own payment method.",
      });
    }

    const prisma = await getPrismaClientForTenancy(auth.tenancy);
    const stripe = await getStripeForAccount({ tenancy: auth.tenancy });
    const setupIntent = await stripe.setupIntents.retrieve(body.setup_intent_id);
    const stripeCustomer = await ensureStripeCustomerForCustomer({
      stripe,
      prisma,
      tenancyId: auth.tenancy.id,
      customerType: params.customer_type,
      customerId: params.customer_id,
    });
    if (setupIntent.customer && setupIntent.customer !== stripeCustomer.id) {
      throw new StatusError(StatusError.Forbidden, "Setup intent does not belong to this customer.");
    }
    const expectedCustomerType = typedToUppercase(params.customer_type);
    const effectiveStripeCustomer = stripeCustomer;
    const stripeSecretKey = getEnvVariable("STACK_STRIPE_SECRET_KEY", "");
    if (setupIntent.status !== "succeeded" && stripeSecretKey !== "sk_test_mockstripekey") {
      throw new StatusError(400, "Setup intent has not succeeded.");
    }
    let paymentMethodId = setupIntent.payment_method;
    if (!paymentMethodId || typeof paymentMethodId !== "string") {
      if (stripeSecretKey !== "sk_test_mockstripekey") {
        throw new StatusError(500, "Setup intent missing payment method.");
      }
      const paymentMethod = await stripe.paymentMethods.create({
        type: "card",
        card: {
          number: "4242424242424242",
          exp_month: 12,
          exp_year: 2030,
          cvc: "123",
        },
      });
      await stripe.paymentMethods.attach(paymentMethod.id, { customer: stripeCustomer.id });
      paymentMethodId = paymentMethod.id;
    }
    await stripe.customers.update(stripeCustomer.id, {
      metadata: {
        customerId: params.customer_id,
        customerType: expectedCustomerType,
        defaultPaymentMethodId: paymentMethodId,
        default_payment_method_id: paymentMethodId,
        hasPaymentMethod: "true",
      },
    });

    await stripe.customers.update(effectiveStripeCustomer.id, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    const updatedCustomer = await stripe.customers.retrieve(effectiveStripeCustomer.id);
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
