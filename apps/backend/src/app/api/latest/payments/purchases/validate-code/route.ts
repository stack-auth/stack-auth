import { getSubscriptions, isActiveSubscription } from "@/lib/payments";
import { validateRedirectUrl } from "@/lib/redirect-urls";
import { getTenancy } from "@/lib/tenancies";
import { getPrismaClientForTenancy } from "@/prisma-client";
import { createSmartRouteHandler } from "@/route-handlers/smart-route-handler";
import { KnownErrors } from "@stackframe/stack-shared";
import { inlineProductSchema, urlSchema, yupArray, yupBoolean, yupNumber, yupObject, yupString } from "@stackframe/stack-shared/dist/schema-fields";
import { SUPPORTED_CURRENCIES } from "@stackframe/stack-shared/dist/utils/currency-constants";
import { StackAssertionError } from "@stackframe/stack-shared/dist/utils/errors";
import { filterUndefined, getOrUndefined, typedEntries, typedFromEntries } from "@stackframe/stack-shared/dist/utils/objects";
import * as yup from "yup";
import { purchaseUrlVerificationCodeHandler } from "../verification-code-handler";

const productDataSchema = inlineProductSchema
  .omit(["server_only", "included_items"])
  .concat(yupObject({
    stackable: yupBoolean().defined(),
  }));

export const POST = createSmartRouteHandler({
  metadata: {
    hidden: false,
    summary: "Validate Purchase Code",
    description: "Validates a purchase verification code and returns purchase details including available prices.",
    tags: ["Payments"],
  },
  request: yupObject({
    body: yupObject({
      full_code: yupString().defined(),
      return_url: urlSchema.optional(),
    }),
  }),
  response: yupObject({
    statusCode: yupNumber().oneOf([200]).defined(),
    bodyType: yupString().oneOf(["json"]).defined(),
    body: yupObject({
      product: productDataSchema,
      stripe_account_id: yupString().defined(),
      project_id: yupString().defined(),
      already_bought_non_stackable: yupBoolean().defined(),
      conflicting_products: yupArray(yupObject({
        product_id: yupString().defined(),
        display_name: yupString().defined(),
      }).defined()).defined(),
      test_mode: yupBoolean().defined(),
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
    const productData: yup.InferType<typeof productDataSchema> = {
      display_name: product.displayName ?? "Product",
      customer_type: product.customerType,
      stackable: product.stackable === true,
      prices: product.prices === "include-by-default" ? {} : typedFromEntries(typedEntries(product.prices).map(([key, value]) => [key, filterUndefined({
        ...typedFromEntries(SUPPORTED_CURRENCIES.map(c => [c.code, getOrUndefined(value, c.code)])),
        interval: value.interval,
        free_trial: value.freeTrial,
      })])),
    };

    // Compute purchase context info
    const prisma = await getPrismaClientForTenancy(tenancy);
    const subscriptions = await getSubscriptions({
      prisma,
      tenancy,
      customerType: product.customerType,
      customerId: verificationCode.data.customerId,
    });

    const alreadyBoughtNonStackable = !!(subscriptions.find((s) => s.productId === verificationCode.data.productId) && product.stackable !== true);

    const catalogs = tenancy.config.payments.catalogs;
    const catalogId = Object.keys(catalogs).find((g) => product.catalogId === g);
    let conflictingCatalogProducts: { product_id: string, display_name: string }[] = [];
    if (catalogId) {
      const isSubscribable = product.prices !== "include-by-default" && Object.values(product.prices).some((p: any) => p && p.interval);
      if (isSubscribable) {
        const conflicts = subscriptions.filter((subscription) => (
          subscription.productId &&
          subscription.product.catalogId === catalogId &&
          isActiveSubscription(subscription) &&
          subscription.product.prices !== "include-by-default" &&
          (!product.isAddOnTo || !Object.keys(product.isAddOnTo).includes(subscription.productId))
        ));
        conflictingCatalogProducts = conflicts.map((s) => ({
          product_id: s.productId!,
          display_name: s.product.displayName ?? s.productId!,
        }));
      }
    }

    return {
      statusCode: 200,
      bodyType: "json",
      body: {
        product: productData,
        stripe_account_id: verificationCode.data.stripeAccountId,
        project_id: tenancy.project.id,
        already_bought_non_stackable: alreadyBoughtNonStackable,
        conflicting_products: conflictingCatalogProducts,
        test_mode: tenancy.config.payments.testMode === true,
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
