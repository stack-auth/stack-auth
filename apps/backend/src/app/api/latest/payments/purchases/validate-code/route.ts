import { getPurchaseContext, productToInlineProduct } from "@/lib/payments/index";
import { validateRedirectUrl } from "@/lib/redirect-urls";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { inlineProductSchema, urlSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: false,
    summary: "Validate Purchase Code",
    description: "Validates a purchase verification code and returns purchase details including available prices.",
    tags: ["Payments"],
  },
  request: yupObject({
    body: yupObject({
      full_code: yupString().defined().meta({
        openapiField: {
          description: "The verification code, given as a query parameter in the purchase URL",
          exampleValue: "proj_abc123_def456ghi789"
        }
      }),
      return_url: urlSchema.optional().meta({
        openapiField: {
          description: "URL to redirect to after purchase completion",
          exampleValue: "https://myapp.com/purchase-success"
        }
      }),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      product: inlineProductSchema,
      stripe_account_id: yupString().defined(),
      project_id: yupString().defined(),
      project_logo_url: yupString().nullable().defined(),
      already_bought_non_stackable: yupBoolean().defined(),
      conflicting_products: yupArray(yupObject({
        product_id: yupString().defined(),
        display_name: yupString().defined(),
      }).defined()).defined(),
      test_mode: yupBoolean().defined(),
      charges_enabled: yupBoolean().defined(),
    }).defined(),
  }),
  async handler({ body }) {
    const verificationCode = await purchaseUrlVerificationCodeHandler.validateCode(body.full_code);
    const tenancy = await getTenancy(verificationCode.data.tenancyId);
    if (!tenancy) {
      throw new StackAssertionError(`No tenancy found for given tenancyId`);
    }
    if (body.return_url && !validateRedirectUrl(body.return_url, tenancy)) {
      throw new KnownErrors.RedirectUrlNotWhitelisted();
    }
    const product = verificationCode.data.product;

    const prisma = await getPrismaClientForTenancy(tenancy);
    const { alreadyOwnsProduct, conflictingProducts } = await getPurchaseContext({
      prisma,
      tenancy,
      customerType: product.customerType,
      customerId: verificationCode.data.customerId,
      product,
      productId: verificationCode.data.productId,
    });

    const alreadyBoughtNonStackable = product.stackable !== true && alreadyOwnsProduct;
    const conflictingProductLineProducts = conflictingProducts
      .filter((owned) => owned.id)
      .map((owned) => ({
        product_id: owned.id!,
        display_name: owned.product.display_name,
      }));

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        product: productToInlineProduct(product),
        stripe_account_id: verificationCode.data.stripeAccountId,
        project_id: tenancy.project.id,
        project_logo_url: tenancy.project.logo_url ?? null,
        already_bought_non_stackable: alreadyBoughtNonStackable,
        conflicting_products: conflictingProductLineProducts,
        test_mode: tenancy.config.payments.testMode === true,
        charges_enabled: verificationCode.data.chargesEnabled,
      },
    };
  },
});


export const GET = createSmartRouteHandler({
  metadata: {
    hidden: true,
  },
  request: yupObject({
    query: yupObject({
      full_code: yupString().defined(),
      return_url: urlSchema.optional(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      valid: yupBoolean().defined(),
    }).defined(),
  }),
  async handler({ query }) {
    const tenancyId = query.full_code.split("_")[0];
    if (!tenancyId) {
      throw new KnownErrors.VerificationCodeNotFound();
    }
    const tenancy = await getTenancy(tenancyId);
    if (!tenancy) {
      throw new KnownErrors.VerificationCodeNotFound();
    }
    if (query.return_url && !validateRedirectUrl(query.return_url, tenancy)) {
      throw new KnownErrors.RedirectUrlNotWhitelisted();
    }
    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        valid: true,
      },
    };
  },
});
