import { ensureProductIdOrInlineProduct, getCustomerPurchaseContext } from "@/lib/payments";
import { validateRedirectUrl } from "@/lib/redirect-urls";
import { getStripeForAccount } from "@/lib/stripe";
import { getPrismaClientForTenancy, globalPrismaClient } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { CustomerType } from "@prisma/client";
import { KnownErrors } from "@stackframe/stack-shared/dist/known-errors";
import { adaptSchema, clientOrHigherAuthTypeSchema, inlineProductSchema, urlSchema, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { getEnvVariable } from "@stackframe/stack-shared/dist/utils/env";
import { StatusError, throwErr } from "@stackframe/stack-shared/dist/utils/errors";
import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: false,
    summary: "Create Purchase URL",
    description: "Creates a secure checkout URL for purchasing a product.",
    tags: ["Payments"],
  },
  request: yupObject({
    auth: yupObject({
      type: clientOrHigherAuthTypeSchema.defined(),
      project: adaptSchema.defined(),
      tenancy: adaptSchema.defined(),
    }).defined(),
    body: yupObject({
      customer_type: yupString().oneOf(["user", "team", "custom"]).defined().meta({
        openapiField: {
          description: "The type of customer making the purchase",
          exampleValue: "user"
        }
      }),
      customer_id: yupString().defined().meta({
        openapiField: {
          description: "The ID of the customer (user ID, team ID, or custom customer ID)",
          exampleValue: "user_1234567890abcdef"
        }
      }),
      product_id: yupString().optional().meta({
        openapiField: {
          description: "The ID of the product to purchase. Either this or product_inline should be given.",
          exampleValue: "prod_premium_monthly"
        }
      }),
      product_inline: inlineProductSchema.optional().meta({
        openapiField: {
          description: "Inline product definition. Either this or product_id should be given."
        }
      }),
      return_url: urlSchema.optional().meta({
        openapiField: {
          description: "URL to redirect to after purchase completion. Must be configured as a trusted domain in the project configuration.",
          exampleValue: "https://myapp.com/purchase-success"
        }
      }),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      url: yupString().defined().meta({
        openapiField: {
          description: "The secure checkout URL for completing the purchase"
        }
      }),
    }).defined(),
  }),
  handler: async (req) => {
    const { tenancy } = req.auth;
    const stripe = await getStripeForAccount({ tenancy });
    const productConfig = await ensureProductIdOrInlineProduct(tenancy, req.auth.type, req.body.product_id, req.body.product_inline);
    const customerType = productConfig.customerType;
    if (req.body.customer_type !== customerType) {
      throw new KnownErrors.ProductCustomerTypeDoesNotMatch(req.body.product_id, req.body.customer_id, customerType, req.body.customer_type);
    }

    if (req.body.product_id && productConfig.stackable !== true) {
      const prisma = await getPrismaClientForTenancy(tenancy);
      const { alreadyOwnsProduct } = await getCustomerPurchaseContext({
        prisma,
        tenancy,
        customerType,
        customerId: req.body.customer_id,
        productId: req.body.product_id,
      });
      if (alreadyOwnsProduct) {
        throw new KnownErrors.ProductAlreadyGranted(req.body.product_id, req.body.customer_id);
      }
    }

    const stripeCustomerSearch = await stripe.customers.search({
      query: `metadata['customerId']:'${req.body.customer_id}'`,
    });
    let stripeCustomer = stripeCustomerSearch.data.length ? stripeCustomerSearch.data[0] : undefined;
    if (!stripeCustomer) {
      stripeCustomer = await stripe.customers.create({
        metadata: {
          customerId: req.body.customer_id,
          customerType: customerType === "user" ? CustomerType.USER : CustomerType.TEAM,
        }
      });
    }

    const project = await globalPrismaClient.project.findUnique({
      where: { id: tenancy.project.id },
      select: { stripeAccountId: true },
    });

    const { code } = await purchaseUrlVerificationCodeHandler.createCode({
      tenancy,
      expiresInMs: 1000 * 60 * 60 * 24,
      data: {
        tenancyId: tenancy.id,
        customerId: req.body.customer_id,
        productId: req.body.product_id,
        product: productConfig,
        stripeCustomerId: stripeCustomer.id,
        stripeAccountId: project?.stripeAccountId ?? throwErr("Stripe account not configured"),
      },
      method: {},
      callbackUrl: undefined,
    });

    const fullCode = `${tenancy.id}_${code}`;
    const url = new URL(`/purchase/${fullCode}`, getEnvVariable("NEXT_PUBLIC_STACK_DASHBOARD_URL"));
    if (req.body.return_url) {
      if (!validateRedirectUrl(req.body.return_url, tenancy)) {
        throw new KnownErrors.RedirectUrlNotWhitelisted();
      }
      url.searchParams.set("return_url", req.body.return_url);
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        url: url.toString(),
      },
    };
  },
});
